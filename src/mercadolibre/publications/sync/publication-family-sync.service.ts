import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import {
  ResolvedUserProductFamily,
  UserProductFamilyCache,
} from '../../user-products/user-product.types';
import {
  MercadoLibrePublication,
  NormalizationContext,
} from '../publication.types';
import {
  exceptionToSyncError,
  requireItemId,
  requireUserProductId,
} from './publication-sync.helpers';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import {
  PublicationBatchResult,
  SavedPublications,
  SyncAccess,
} from './publication-sync.types';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

@Injectable()
export class PublicationFamilySyncService {
  /** Recibe los servicios existentes para reconstruir familias. */
  constructor(
    private readonly familyService: UserProductFamilyService,
    private readonly sourceService: PublicationSourceService,
    private readonly preparer: PublicationSyncPreparerService,
    private readonly writer: PublicationSyncWriterService,
  ) {}

  /** Reconstruye una vez cada familia encontrada en el batch. */
  async syncBatch(
    publications: MercadoLibrePublication[],
    access: SyncAccess,
    fullSyncId: string,
  ): Promise<PublicationBatchResult> {
    const cache = this.familyService.createCache();
    const seenFamilies = new Set<string>();
    const result: PublicationBatchResult = {
      productsSaved: 0,
      childrenSaved: 0,
      errors: [],
    };

    for (const publication of publications) {
      const itemId = safeItemId(publication);
      try {
        const family = await this.resolveFamily(publication, access, cache);
        if (seenFamilies.has(family.familyId)) continue;
        seenFamilies.add(family.familyId);
        const saved = await this.saveResolvedFamily(
          family,
          access,
          cache,
          fullSyncId,
          itemId,
        );
        result.productsSaved += saved.productsSaved;
        result.childrenSaved += saved.childrenSaved;
      } catch (error) {
        if (isFatalFamilyError(error)) throw error;
        result.errors.push(exceptionToSyncError(itemId, error));
      }
    }
    return result;
  }

  /** Sincroniza la familia completa de una publicación puntual. */
  async syncPublication(
    publication: MercadoLibrePublication,
    access: SyncAccess,
  ): Promise<void> {
    const cache = this.familyService.createCache();
    const family = await this.resolveFamily(publication, access, cache);
    await this.saveResolvedFamily(
      family,
      access,
      cache,
      undefined,
      requireItemId(publication),
    );
  }

  /** Resuelve una familia y verifica que pertenezca al vendedor. */
  private async resolveFamily(
    publication: MercadoLibrePublication,
    access: SyncAccess,
    cache: UserProductFamilyCache,
  ): Promise<ResolvedUserProductFamily> {
    const family = await this.familyService.resolveFamily(
      requireUserProductId(publication),
      access.accessToken,
      cache,
    );
    if (family.userId !== access.sellerId) {
      throw new ForbiddenException('La familia pertenece a otro vendedor');
    }
    return family;
  }

  /** Prepara y guarda una familia completa ya resuelta. */
  private async saveResolvedFamily(
    family: ResolvedUserProductFamily,
    access: SyncAccess,
    cache: UserProductFamilyCache,
    fullSyncId?: string,
    changedItemId?: string,
  ): Promise<SavedPublications> {
    const itemIds = await this.sourceService.getItemIdsForUserProducts(
      access.sellerId,
      family.userProductIds,
      access.accessToken,
    );
    const source = await this.sourceService.getPublicationDetails(
      [...new Set([...itemIds, ...(changedItemId ? [changedItemId] : [])])],
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
   if (!bundle) {
  throw new BadGatewayException(
    'La familia no pudo normalizarse completa',
  );
}
    await this.writer.save(bundle, fullSyncId);
    return {
      processedItems: bundle.children.length,
      productsSaved: 1,
      childrenSaved: bundle.children.length,
    };
  }

  /** Crea el contexto de normalización de la familia. */
  private createContext(sellerId: number): NormalizationContext {
    return { sellerId, syncedAt: new Date().toISOString() };
  }
}

/** Devuelve una referencia segura para un error individual. */
function safeItemId(publication: MercadoLibrePublication): string {
  try {
    return requireItemId(publication);
  } catch {
    return 'unknown-item';
  }
}

/** Separa fallas sistémicas de errores propios de un MLA. */
function isFatalFamilyError(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return status === 401 || status >= 500;
}
