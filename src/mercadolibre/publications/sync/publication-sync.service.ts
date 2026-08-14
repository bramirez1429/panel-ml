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
import { PublicationOfficialPriceService } from '../prices/publication-official-price.service';
import {
  filterPublicationsBySeller,
  mapWithConcurrency,
  requireItemId,
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
    private readonly officialPrices: PublicationOfficialPriceService,
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
    await this.syncKnownItem(publication, access);
  }

  /** Sincroniza una respuesta de item ya disponible sin volver a consultarla. */
  async syncKnownItem(
    publication: MercadoLibrePublication,
    access: SyncAccess,
    hasOfficialPrice = false,
  ): Promise<void> {
    await this.syncKnownItems([publication], access, hasOfficialPrice);
  }

  /** Sincroniza respuestas ya disponibles y devuelve su clave externa interna. */
  async syncKnownItems(
    publications: MercadoLibrePublication[],
    access: SyncAccess,
    hasOfficialPrice = false,
  ): Promise<string> {
    if (publications.length === 0) {
      throw new BadGatewayException('No hay publicaciones para sincronizar');
    }
    const priced = hasOfficialPrice
      ? publications
      : await this.officialPrices.hydrateMany(
          publications,
          access.accessToken,
        );
    const itemIds = priced.map(requireItemId);
    if (priced.some(({ seller_id }) => seller_id !== access.sellerId)) {
      throw new ForbiddenException('La publicación pertenece a otro vendedor');
    }
    const models = new Set(priced.map((item) => this.detector.detect(item)));
    if (models.size !== 1) {
      throw new BadGatewayException('Los items creados usan modelos distintos');
    }
    if (models.has('SHARED')) {
      if (priced.length !== 1) {
        throw new BadGatewayException('Se recibieron varios items SHARED');
      }
      await this.savePartial(priced, access);
      return `item:${itemIds[0]}`;
    }
    const familyId = await this.familySyncService.syncPublications(
      priced,
      access,
    );
    return `family:${familyId}`;
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
