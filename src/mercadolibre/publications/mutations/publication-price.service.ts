import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationOfficialPriceService } from '../prices/publication-official-price.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import {
  priceAuditValue,
  runAuditedPublicationMutation,
} from './publication-mutation-audit.helpers';
import { parseOptionalItemId } from './publication-management.types';
import { PublicationManagementTargetService } from './publication-management-target.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';
import { parsePublicationUpdateVariations } from './publication-update-variations.helpers';

type PriceInput = Readonly<{
  price: number;
  itemId: string | null;
}>;

@Injectable()
export class PublicationPriceService {
  /** Recibe cambios de precio validados para una publicación segura. */
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly syncService: PublicationSyncService,
    private readonly activity: PublicationActivityService,
    private readonly officialPrices: PublicationOfficialPriceService,
  ) {}

  /** Actualiza el precio en Mercado Libre y sincroniza el item afectado. */
  async update(productId: string, body: unknown) {
    const input = parsePriceInput(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'PRICE_UPDATED' as const,
      oldValue: null as unknown,
      newValue: { price: input.price },
    };

    return runAuditedPublicationMutation(this.activity, audit, async () => {
      const item = await this.targets.getOwnedItem(context);
      audit.oldValue = priceAuditValue(item);
      assertManualPrice(item.tags);

      const variations = parsePublicationUpdateVariations(item.variations);
      const payload =
        context.product.model === 'SHARED' && variations.length > 0
          ? {
              variations: variations.map(({ rawId }) => ({
                id: rawId,
                price: input.price,
              })),
            }
          : { price: input.price };

      const response = await this.apiService.put<unknown>(
        `/items/${encodeURIComponent(context.target.itemId)}`,
        payload,
        context.accessToken,
        'priceMutation',
      );
      const publication = mutationItemResponse(response, context);
      const official = await this.officialPrices.read(
        publication,
        context.accessToken,
      );
      if (official.standardPrice !== input.price) {
        throw new ConflictException(
          'Mercado Libre no aplico el precio solicitado',
        );
      }
      await this.syncService.syncKnownItem(
        official.publication,
        mutationSyncAccess(context),
        true,
      );

      return {
        ok: true as const,
        productId,
        itemId: context.target.itemId,
        field: 'price' as const,
        value: input.price,
      };
    });
  }
}

// Valida el body de precio sin depender de transformaciones globales.
function parsePriceInput(body: unknown): PriceInput {
  if (
    !isJsonObject(body) ||
    typeof body.price !== 'number' ||
    !Number.isFinite(body.price) ||
    body.price <= 0
  ) {
    throw new BadRequestException('price debe ser un número mayor que cero');
  }
  return { price: body.price, itemId: parseOptionalItemId(body.itemId) };
}

// Evita escribir precios controlados por automatización de Mercado Libre.
function assertManualPrice(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw new BadGatewayException(
      'Mercado Libre devolvió tags de publicación inválidos',
    );
  }
  if (value.includes('dynamic_standard_price')) {
    throw new ConflictException(
      'Mercado Libre administra automáticamente el precio de esta publicación',
    );
  }
}
