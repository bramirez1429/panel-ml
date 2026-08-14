import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(
    PublicationFamilySyncService.name,
  );

  /** Recibe los servicios necesarios para reconstruir familias. */
  constructor(
    private readonly familyService: UserProductFamilyService,
    private readonly sourceService: PublicationSourceService,
    private readonly preparer: PublicationSyncPreparerService,
    private readonly writer: PublicationSyncWriterService,
  ) {}

  /** Reconstruye una sola vez cada familia encontrada en el batch. */
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
        const family = await this.resolveFamily(
          publication,
          access,
          cache,
        );

        // Evita reconstruir dos veces la misma familia.
        if (seenFamilies.has(family.familyId)) {
          continue;
        }

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
        // Errores sistémicos se dejan subir para poder reintentar el job.
        if (isFatalFamilyError(error)) {
          throw error;
        }

        // Un error individual queda registrado sin romper todo el batch.
        result.errors.push(
          exceptionToSyncError(itemId, error),
        );
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

    const family = await this.resolveFamily(
      publication,
      access,
      cache,
    );

    await this.saveResolvedFamily(
      family,
      access,
      cache,
      undefined,
      requireItemId(publication),
    );
  }

  /** Resuelve la familia y verifica que pertenezca al seller. */
  private async resolveFamily(
    publication: MercadoLibrePublication,
    access: SyncAccess,
    cache: UserProductFamilyCache,
  ): Promise<ResolvedUserProductFamily> {
    const userProductId =
      requireUserProductId(publication);

    const family =
      await this.familyService.resolveFamily(
        userProductId,
        access.accessToken,
        cache,
      );

    if (family.userId !== access.sellerId) {
      throw new ForbiddenException(
        'La familia pertenece a otro vendedor',
      );
    }

    return family;
  }

  /** Reconstruye, valida y guarda una familia completa. */
  private async saveResolvedFamily(
    family: ResolvedUserProductFamily,
    access: SyncAccess,
    cache: UserProductFamilyCache,
    fullSyncId?: string,
    changedItemId?: string,
  ): Promise<SavedPublications> {
    const familyItemIds =
      await this.sourceService.getItemIdsForUserProducts(
        access.sellerId,
        family.userProductIds,
        access.accessToken,
      );

    const expectedItemIds = [
      ...new Set([
        ...familyItemIds,
        ...(changedItemId ? [changedItemId] : []),
      ]),
    ];

    const source =
      await this.sourceService.getPublicationDetails(
        expectedItemIds,
        access.accessToken,
      );

    // Si faltó obtener algún MLA, no guardamos una familia parcial.
    if (source.errors.length > 0) {
      this.logger.warn(
        `No se pudo obtener completa la familia ${family.familyId}. ` +
          `Errores: ${source.errors.length}`,
      );

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

    // Buscamos solamente la familia que estamos sincronizando.
   const bundle = prepared.bundles.find(
  ({ parent }) =>
    parent.family_id === family.familyId,
);

if (!bundle) {
  this.logger.warn(
    `No se encontró bundle para family_id ${family.familyId}`,
  );

  throw new BadGatewayException(
    'No se encontró la familia normalizada',
  );
}

if (prepared.errors.length > 0) {
  this.logger.warn(
    `Family ${family.familyId} tuvo ${prepared.errors.length} errores de normalización`,
  );
}

await this.writer.save(
  bundle,
  fullSyncId,
);

return {
  processedItems: bundle.children.length,
  productsSaved: 1,
  childrenSaved: bundle.children.length,
};
}

  /** Crea el contexto usado durante la normalización. */
  private createContext(
    sellerId: number,
  ): NormalizationContext {
    return {
      sellerId,
      syncedAt: new Date().toISOString(),
    };
  }
}

/** Comprueba que el bundle tenga todos los MLA esperados. */
function isFamilyBundleComplete(
  bundle: {
    children: Array<{ item_id: string }>;
  },
  expectedItemIds: string[],
): boolean {
  const normalizedIds = new Set(
    bundle.children.map(
      (child) => child.item_id,
    ),
  );

  return expectedItemIds.every(
    (itemId) => normalizedIds.has(itemId),
  );
}

/** Devuelve una referencia segura para un error individual. */
function safeItemId(
  publication: MercadoLibrePublication,
): string {
  try {
    return requireItemId(publication);
  } catch {
    return 'unknown-item';
  }
}

/** Separa fallas sistémicas de errores propios de un MLA. */
function isFatalFamilyError(
  error: unknown,
): boolean {
  if (!(error instanceof HttpException)) {
    return false;
  }

  const status = error.getStatus();

  return (
    status === 401 ||
    status === 429 ||
    status >= 500
  );
}