import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationModelDetectorService } from '../normalization/publication-model-detector.service';
import {
  MercadoLibrePublication,
  NormalizationContext,
  NormalizedPublicationBundle,
} from '../publication.types';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../publication.constants';
import {
  filterPublicationsBySeller,
  mapWithConcurrency,
  sourceErrorToSyncError,
} from './publication-sync.helpers';
import { PublicationFamilySyncService } from './publication-family-sync.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import {
  PublicationBatchResult,
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
    private readonly familySyncService: PublicationFamilySyncService,
    private readonly writer: PublicationSyncWriterService,
  ) {}

  /** Procesa solamente los MLA recibidos y marca el full sync. */
  async syncBatch(
    itemIds: string[],
    access: SyncAccess,
    fullSyncId: string,
  ): Promise<PublicationBatchResult> {
    const source = await this.sourceService.getPublicationDetails(
      itemIds,
      access.accessToken,
    );
    const owned = filterPublicationsBySeller(
      source.publications,
      access.sellerId,
    );
    const shared = owned.publications.filter(
      (item) => this.detector.detect(item) === 'SHARED',
    );
    const prepared = await this.preparer.prepare(
      shared,
      access.accessToken,
      this.createContext(access.sellerId),
      this.familyService.createCache(),
    );
    const sharedSaved = await this.saveBundles(prepared.bundles, fullSyncId);
    const variants = owned.publications.filter(
      (item) => this.detector.detect(item) === 'VARIANT_PRICING',
    );
    const variantResult = await this.familySyncService.syncBatch(
      variants,
      access,
      fullSyncId,
    );

    return {
      productsSaved: sharedSaved.productsSaved + variantResult.productsSaved,
      childrenSaved: sharedSaved.childrenSaved + variantResult.childrenSaved,
      errors: [
        ...source.errors.map(sourceErrorToSyncError),
        ...owned.errors,
        ...prepared.errors,
        ...variantResult.errors,
      ],
    };
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
      throw new ForbiddenException('La publicación pertenece a otro vendedor');
    }
    if (this.detector.detect(publication) === 'SHARED') {
      await this.savePartial([publication], access);
      return;
    }
    await this.familySyncService.syncPublication(publication, access);
  }

  /** Elimina productos que no fueron vistos al terminar el scan. */
  async finalizeFullSync(
    sellerId: number,
    fullSyncId: string,
    syncStartedAt: string,
  ): Promise<void> {
    await this.writer.finalizeFullSync(sellerId, fullSyncId, syncStartedAt);
  }

  /** Obtiene seller y token sin exponerlos en respuestas. */
  private async getAccess(): Promise<SyncAccess> {
    const connection = await this.tokenService.getStoredConnection();
    return {
      sellerId: connection.seller_id,
      accessToken: await this.tokenService.getValidAccessToken(connection),
    };
  }

  /** Normaliza y guarda una publicación SHARED puntual. */
  private async savePartial(
    publications: MercadoLibrePublication[],
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
    fullSyncId?: string,
  ): Promise<SavedPublications> {
    await mapWithConcurrency(
      bundles,
      PUBLICATION_REQUEST_CONCURRENCY,
      (bundle) => this.writer.save(bundle, fullSyncId),
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
}
