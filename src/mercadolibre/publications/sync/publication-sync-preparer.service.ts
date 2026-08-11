import { Injectable } from '@nestjs/common';
import { UserProductFamilyCache } from '../../user-products/user-product.types';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationModelDetectorService } from '../normalization/publication-model-detector.service';
import { PublicationNormalizerService } from '../normalization/publication-normalizer.service';
import {
  MercadoLibrePublication,
  NormalizationContext,
  NormalizedPublicationBundle,
  ResolvedVariantPublication,
} from '../publication.types';
import {
  exceptionToSyncError,
  groupByFamily,
  mapWithConcurrency,
  requireItemId,
  requireUserProductId,
} from './publication-sync.helpers';
import {
  PreparedPublications,
  PublicationSyncError,
} from './publication-sync.types';
import { isMercadoLibreRateLimitError } from './publication-sync-job-error.helpers';

const RESOLUTION_CONCURRENCY = 1;

type ResolutionAttempt = {
  resolved?: ResolvedVariantPublication;
  error?: PublicationSyncError;
};

@Injectable()
export class PublicationSyncPreparerService {
  /** Recibe detección, normalización y resolución de familias. */
  constructor(
    private readonly detector: PublicationModelDetectorService,
    private readonly normalizer: PublicationNormalizerService,
    private readonly familyService: UserProductFamilyService,
  ) {}

  /** Convierte publicaciones externas en bundles persistibles. */
  async prepare(
    publications: MercadoLibrePublication[],
    accessToken: string,
    context: NormalizationContext,
    cache: UserProductFamilyCache,
  ): Promise<PreparedPublications> {
    const shared = publications.filter(
      (item) => this.detector.detect(item) === 'SHARED',
    );
    const variants = publications.filter(
      (item) => this.detector.detect(item) === 'VARIANT_PRICING',
    );
    const sharedResult = this.normalizeShared(shared, context);
    const variantResult = await this.resolveVariants(
      variants,
      accessToken,
      cache,
      context.sellerId,
    );
    const familyResult = this.normalizeFamilies(
      variantResult.resolved,
      context,
    );

    return {
      bundles: [...sharedResult.bundles, ...familyResult.bundles],
      errors: [
        ...sharedResult.errors,
        ...variantResult.errors,
        ...familyResult.errors,
      ],
    };
  }

  /** Normaliza publicaciones SHARED sin abortar las demás. */
  private normalizeShared(
    publications: MercadoLibrePublication[],
    context: NormalizationContext,
  ): PreparedPublications {
    const bundles: NormalizedPublicationBundle[] = [];
    const errors: PublicationSyncError[] = [];

    for (const publication of publications) {
      const itemId = safeItemId(publication);
      try {
        bundles.push(this.normalizer.normalizeShared(publication, context));
      } catch (error) {
        errors.push(exceptionToSyncError(itemId, error));
      }
    }
    return { bundles, errors };
  }

  /** Resuelve MLAU y family_id con concurrencia limitada. */
  private async resolveVariants(
    publications: MercadoLibrePublication[],
    accessToken: string,
    cache: UserProductFamilyCache,
    sellerId: number,
  ): Promise<{
    resolved: ResolvedVariantPublication[];
    errors: PublicationSyncError[];
  }> {
    const attempts = await mapWithConcurrency(
      publications,
      RESOLUTION_CONCURRENCY,
      async (publication): Promise<ResolutionAttempt> => {
        const itemId = safeItemId(publication);
        try {
          const userProductId = requireUserProductId(publication);
          const family = await this.familyService.resolveFamily(
            userProductId,
            accessToken,
            cache,
          );
          if (family.userId !== sellerId) {
            throw new Error('La familia pertenece a otro vendedor');
          }
          return {
            resolved: {
              publication,
              familyId: family.familyId,
              userProductId,
              userProductName: family.userProductName,
            },
          };
        } catch (error) {
          if (isMercadoLibreRateLimitError(error)) throw error;
          return { error: exceptionToSyncError(itemId, error) };
        }
      },
    );

    return {
      resolved: attempts.flatMap(({ resolved }) =>
        resolved ? [resolved] : [],
      ),
      errors: attempts.flatMap(({ error }) => (error ? [error] : [])),
    };
  }

  /** Normaliza cada familia sin afectar familias independientes. */
  private normalizeFamilies(
    publications: ResolvedVariantPublication[],
    context: NormalizationContext,
  ): PreparedPublications {
    const bundles: NormalizedPublicationBundle[] = [];
    const errors: PublicationSyncError[] = [];

    for (const family of groupByFamily(publications).values()) {
      try {
        bundles.push(this.normalizer.normalizeVariantFamily(family, context));
      } catch (error) {
        for (const item of family) {
          errors.push(
            exceptionToSyncError(safeItemId(item.publication), error),
          );
        }
      }
    }
    return { bundles, errors };
  }
}

/** Devuelve el MLA o una referencia segura para errores. */
function safeItemId(publication: MercadoLibrePublication): string {
  try {
    return requireItemId(publication);
  } catch {
    return 'unknown-item';
  }
}
