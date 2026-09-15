import { Injectable, Logger } from '@nestjs/common';
import { MercadolibreTokenService } from '../mercadolibre/auth/mercadolibre-token.service';
import type { MlItem } from '../mercadolibre/direct-publications/items/items.types';
import { PublicationSourceService } from '../mercadolibre/publications/sync/publication-source.service';
import { MercadolibreApiService } from '../mercadolibre/shared/mercadolibre-api.service';
import { RecentSalesRepository } from './recent-sales.repository';
import { mapClassicItem } from './mercadolibre-curve.service';
import type { SaveRecentSale, VariantChannelLink } from './sales.types';
import { isObject, text } from './variant-normalization';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

@Injectable()
export class MercadolibreSaleIngestionService {
  private readonly logger = new Logger(MercadolibreSaleIngestionService.name);

  constructor(
    private readonly tokens: MercadolibreTokenService,
    private readonly api: MercadolibreApiService,
    private readonly publications: PublicationSourceService,
    private readonly sales: RecentSalesRepository,
    private readonly links: VariantChannelLinksRepository,
  ) {}

  receive(orderId: string, sellerId: number): void {
    void this.process(orderId, sellerId).catch(() => {
      this.logger.warn(`No se pudo registrar la orden ${orderId}`);
    });
  }

  async process(orderId: string, sellerId: number): Promise<void> {
    const connection =
      await this.tokens.getStoredConnectionBySellerId(sellerId);
    const accessToken = await this.tokens.getValidAccessToken(
      connection.user_id,
      connection,
    );
    const order = await this.api.get<unknown>(
      `/orders/${encodeURIComponent(orderId)}`,
      accessToken,
    );
    if (!isPaidOrder(order, orderId)) return;

    const orderItems = Array.isArray(order.order_items)
      ? order.order_items.filter(isObject)
      : [];
    const itemIds = [
      ...new Set(
        orderItems.flatMap((line) => {
          const item = isObject(line.item) ? line.item : null;
          const itemId = text(item?.id);
          return itemId && /^MLA\d+$/u.test(itemId) ? [itemId] : [];
        }),
      ),
    ];
    const [itemResults, persistedLinks] = await Promise.all([
      Promise.allSettled(
        itemIds.map((itemId) =>
          this.publications.getItemWithAllAttributes(itemId, accessToken),
        ),
      ),
      this.links.findByUserId(connection.user_id),
    ]);
    const items = new Map<string, MlItem>();
    itemResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        items.set(itemIds[index], result.value as MlItem);
      }
    });

    const soldAt =
      timestamp(order.date_closed) ?? timestamp(order.date_created);
    if (!soldAt) return;
    const records = orderItems.flatMap((line) => {
      const source = isObject(line.item) ? line.item : null;
      const itemId = text(source?.id);
      const quantity = positiveInteger(line.quantity);
      if (!itemId || !/^MLA\d+$/u.test(itemId) || !quantity) return [];
      const variationId = text(source?.variation_id);
      const item = items.get(itemId);
      const current = item
        ? (mapClassicItem(item).find(
            (variant) => variant.ml?.variationId === variationId,
          ) ?? mapClassicItem(item)[0])
        : null;
      const linked = findMlLink(persistedLinks, itemId, variationId);
      return [
        {
          userId: connection.user_id,
          channel: 'MERCADOLIBRE',
          externalOrderId: orderId,
          externalOrderItemId:
            text(line.id) ?? `${itemId}:${variationId ?? 'item'}`,
          soldAt,
          quantity,
          productName: text(source?.title) ?? text(item?.title) ?? itemId,
          sku:
            text(source?.seller_sku) ??
            text(source?.seller_custom_field) ??
            current?.sku ??
            null,
          mlItemId: itemId,
          mlVariationId: variationId,
          userProductId:
            text(source?.user_product_id) ?? current?.ml?.userProductId ?? null,
          familyId: current?.ml?.familyId ?? text(item?.family_id),
          tnProductId: linked?.tnProductId ?? null,
          tnVariantId: linked?.tnVariantId ?? null,
          color:
            current?.color ??
            attributeValue(source?.variation_attributes, 'color'),
          size:
            current?.size ??
            attributeValue(source?.variation_attributes, 'size'),
          mappingStatus: linked ? 'LINKED' : 'UNLINKED',
        } satisfies SaveRecentSale,
      ];
    });
    await this.sales.saveMany(records);
  }
}

function isPaidOrder(
  value: unknown,
  orderId: string,
): value is Record<string, unknown> {
  return (
    isObject(value) &&
    text(value.id) === orderId &&
    (value.status === 'paid' ||
      (Array.isArray(value.tags) && value.tags.includes('paid')))
  );
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString()
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function findMlLink(
  links: VariantChannelLink[],
  itemId: string,
  variationId: string | null,
): VariantChannelLink | null {
  return (
    links.find(
      (link) => link.mlItemId === itemId && link.mlVariationId === variationId,
    ) ?? null
  );
}

function attributeValue(
  value: unknown,
  expected: 'color' | 'size',
): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const id = text(entry.id)?.toLocaleLowerCase();
    const name = text(entry.name)?.toLocaleLowerCase();
    if (
      id === expected ||
      name === expected ||
      (expected === 'size' && name === 'talle')
    ) {
      return text(entry.value_name);
    }
  }
  return null;
}
