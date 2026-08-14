import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import {
  parseLiveAttributes,
  parseLiveVariations,
  parseVariationId,
  replaceSellerSku,
  sellerSku,
} from './publication-management.types';
import {
  runAuditedPublicationMutation,
  skuAuditValue,
} from './publication-mutation-audit.helpers';
import { PublicationSnapshotService } from './publication-snapshot.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';

@Injectable()
export class PublicationSkuService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly sync: PublicationSyncService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Actualiza SELLER_SKU sin alterar los demas atributos del item o variante. */
  async update(productId: string, body: unknown) {
    const input = parseInput(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'SKU_UPDATED' as const,
      oldValue: null as unknown,
      newValue: { sku: input.sku, variationId: input.variationId },
    };

    return runAuditedPublicationMutation(this.activity, audit, async () => {
      const live = await this.targets.getOwnedItem(context, true);
      audit.oldValue = skuAuditValue(live, input.variationId);
      const payload = this.payload(context.target.model, live, input);
      const response = await this.apiService.put<unknown>(
        `/items/${encodeURIComponent(context.target.itemId)}`,
        payload,
        context.accessToken,
        'skuMutation',
      );
      const refreshed = mutationItemResponse(response, context);
      assertSkuApplied(refreshed, context.target.model, input);
      await this.sync.syncKnownItem(refreshed, mutationSyncAccess(context));
      const snapshot = await this.snapshots.persist(context.target, refreshed);
      return { ok: true as const, productId, ...snapshot };
    });
  }

  private payload(
    model: 'SHARED' | 'VARIANT_PRICING',
    live: Record<string, unknown>,
    input: SkuInput,
  ) {
    if (model === 'VARIANT_PRICING') {
      if (input.variationId !== null) {
        throw new BadRequestException(
          'variationId no corresponde a VARIANT_PRICING',
        );
      }
      return {
        attributes: replaceSellerSku(
          parseLiveAttributes(live.attributes ?? []),
          input.sku,
        ),
      };
    }
    const variations = parseLiveVariations(live.variations);
    if (variations.length === 0) {
      if (input.variationId !== null) {
        throw new NotFoundException('La publicacion no tiene variaciones');
      }
      return {
        attributes: replaceSellerSku(
          parseLiveAttributes(live.attributes ?? []),
          input.sku,
        ),
      };
    }
    if (!input.variationId) {
      throw new BadRequestException('variationId es obligatorio');
    }
    const selected = variations.find(
      ({ id }) => String(id) === input.variationId,
    );
    if (!selected) throw new NotFoundException('La variacion no existe');
    return {
      variations: variations.map((variation) => ({
        id: variation.id,
        ...(variation === selected
          ? { attributes: replaceSellerSku(variation.attributes, input.sku) }
          : {}),
      })),
    };
  }
}

function assertSkuApplied(
  item: Record<string, unknown>,
  model: 'SHARED' | 'VARIANT_PRICING',
  input: SkuInput,
): void {
  const variations = parseLiveVariations(item.variations);
  const applied =
    model === 'SHARED' && input.variationId
      ? sellerSku(
          variations.find(({ id }) => String(id) === input.variationId)
            ?.attributes ?? [],
        )
      : sellerSku(parseLiveAttributes(item.attributes ?? []));
  if (applied !== input.sku) {
    throw new ConflictException('Mercado Libre no aplico el SKU solicitado');
  }
}

type SkuInput = { sku: string; itemId: unknown; variationId: string | null };

function parseInput(body: unknown): SkuInput {
  if (!isJsonObject(body) || !isNonEmptyString(body.sku)) {
    throw new BadRequestException('sku es obligatorio');
  }
  const sku = body.sku.trim();
  if (sku.length > 64)
    throw new BadRequestException('sku admite hasta 64 caracteres');
  return {
    sku,
    itemId: body.itemId,
    variationId:
      body.variationId === undefined || body.variationId === null
        ? null
        : parseVariationId(body.variationId),
  };
}
