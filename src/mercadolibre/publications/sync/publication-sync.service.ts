import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationModelDetectorService } from '../normalization/publication-model-detector.service';
import {
  NormalizationContext,
  NormalizedPublicationBundle,
} from '../publication.types';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../publication.constants';
import {
  mapWithConcurrency,
  filterPublicationsBySeller,
  requireItemId,
  requireUserProductId,
  sourceErrorToSyncError,
} from './publication-sync.helpers';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import {
  PublicationSyncSummary,
  SavedPublications,
  SyncAccess,
} from './publication-sync.types';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

@Injectable()
export class PublicationSyncService {
  /** Recibe servicios pequeños para orquestar la sincronización. */
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly sourceService: PublicationSourceService,
    private readonly familyService: UserProductFamilyService,
    private readonly detector: PublicationModelDetectorService,
    private readonly preparer: PublicationSyncPreparerService,
    private readonly writer: PublicationSyncWriterService,
  ) {}

  /** Sincroniza el snapshot completo del vendedor conectado. */
  async syncAll(): Promise<PublicationSyncSummary> {
    const syncStartedAt = new Date().toISOString();
    const syncId = randomUUID();
    const access = await this.getAccess();
    const itemIds = await this.sourceService.getAllItemIds(
      access.sellerId,
      access.accessToken,
    );
    const source = await this.sourceService.getPublicationDetails(
      itemIds,
      access.accessToken,
    );
    const owned = filterPublicationsBySeller(
      source.publications,
      access.sellerId,
    );
    const context = this.createContext(access.sellerId);
    const prepared = await this.preparer.prepare(
      owned.publications,
      access.accessToken,
      context,
      this.familyService.createCache(),
    );
    const errors = [
      ...source.errors.map(sourceErrorToSyncError),
      ...owned.errors,
      ...prepared.errors,
    ];
    const safeBundles =
      errors.length === 0
        ? prepared.bundles
        : prepared.bundles.filter(({ parent }) => parent.model === 'SHARED');
    const saved = await this.saveBundles(safeBundles, syncId);
    const cleanupPerformed = errors.length === 0;

    if (cleanupPerformed) {
      await this.writer.finalizeFullSync(
        access.sellerId,
        syncId,
        syncStartedAt,
      );
    }
    return this.buildSummary(
      syncId,
      itemIds.length,
      saved,
      errors,
      cleanupPerformed,
    );
  }

  /** Sincroniza solamente el MLA notificado o su familia. */
  async syncItem(itemId: string, notifiedSellerId?: number): Promise<void> {
    const access = await this.getAccess();
    if (notifiedSellerId && notifiedSellerId !== access.sellerId) {
      throw new ForbiddenException('La notificación pertenece a otro vendedor');
    }

    const publication = await this.sourceService.getItem(
      itemId,
      access.accessToken,
    );
    if (publication.seller_id !== access.sellerId) {
      throw new ForbiddenException(
        'La publicaci\u00f3n pertenece a otro vendedor',
      );
    }
    if (this.detector.detect(publication) === 'SHARED') {
      await this.savePartial([publication], access);
      return;
    }
    await this.syncFamily(publication, access);
  }

  /** Obtiene seller y token sin exponerlos en respuestas. */
  private async getAccess(): Promise<SyncAccess> {
    const connection = await this.tokenService.getStoredConnection();
    return {
      sellerId: connection.seller_id,
      accessToken: await this.tokenService.getValidAccessToken(connection),
    };
  }

  /** Sincroniza todos los MLA asociados a una familia. */
  private async syncFamily(
    publication: Parameters<PublicationModelDetectorService['detect']>[0],
    access: SyncAccess,
  ): Promise<void> {
    const cache = this.familyService.createCache();
    const family = await this.familyService.resolveFamily(
      requireUserProductId(publication),
      access.accessToken,
      cache,
    );
    if (family.userId !== access.sellerId) {
      throw new ForbiddenException('La familia pertenece a otro vendedor');
    }
    const itemIds = await this.sourceService.getItemIdsForUserProducts(
      access.sellerId,
      family.userProductIds,
      access.accessToken,
    );
    const changedItemId = requireItemId(publication);
    const source = await this.sourceService.getPublicationDetails(
      [...new Set([...itemIds, changedItemId])],
      access.accessToken,
    );
    if (source.errors.length > 0) {
      throw new BadGatewayException(
        'No se pudo reconstruir la familia completa',
      );
    }

    const prepared = await this.preparer.prepare(
      source.publications,
      access.accessToken,
      this.createContext(access.sellerId),
      cache,
    );
    const bundle = prepared.bundles.find(
      ({ parent }) => parent.family_id === family.familyId,
    );
    if (
      prepared.errors.length > 0 ||
      !bundle ||
      prepared.bundles.length !== 1
    ) {
      throw new BadGatewayException('La familia no pudo normalizarse completa');
    }
    await this.writer.save(bundle);
  }

  /** Normaliza y guarda una publicación SHARED puntual. */
  private async savePartial(
    publications: Parameters<PublicationSyncPreparerService['prepare']>[0],
    access: SyncAccess,
  ): Promise<void> {
    const prepared = await this.preparer.prepare(
      publications,
      access.accessToken,
      this.createContext(access.sellerId),
      this.familyService.createCache(),
    );
    if (prepared.errors.length > 0 || prepared.bundles.length !== 1) {
      throw new BadGatewayException('La publicación no pudo normalizarse');
    }
    await this.writer.save(prepared.bundles[0]);
  }

  /** Guarda bundles con una concurrencia controlada. */
  private async saveBundles(
    bundles: NormalizedPublicationBundle[],
    syncId: string,
  ): Promise<SavedPublications> {
    await mapWithConcurrency(
      bundles,
      PUBLICATION_REQUEST_CONCURRENCY,
      (bundle) => this.writer.save(bundle, syncId),
    );
    return {
      processedItems: bundles.reduce(
        (total, bundle) => total + (bundle.children.length || 1),
        0,
      ),
      productsSaved: bundles.length,
      childrenSaved: bundles.reduce(
        (total, bundle) => total + bundle.children.length,
        0,
      ),
    };
  }

  /** Crea timestamps comunes para una corrida. */
  private createContext(sellerId: number): NormalizationContext {
    return { sellerId, syncedAt: new Date().toISOString() };
  }

  /** Construye la respuesta segura del endpoint manual. */
  private buildSummary(
    syncId: string,
    totalItemIds: number,
    saved: SavedPublications,
    errors: PublicationSyncSummary['errors'],
    cleanupPerformed: boolean,
  ): PublicationSyncSummary {
    return {
      ok: true,
      syncId,
      totalItemIds,
      ...saved,
      cleanupPerformed,
      errors,
    };
  }
}
