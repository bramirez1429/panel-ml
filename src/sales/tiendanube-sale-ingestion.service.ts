import { Injectable, Logger } from '@nestjs/common';
import { TiendanubeConnectionRepository } from '../tiendanube/connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../tiendanube/shared/tiendanube-api.service';
import { RecentSalesRepository } from './recent-sales.repository';
import type { SaveRecentSale, VariantChannelLink } from './sales.types';
import { mapTiendanubeProduct } from './tiendanube-curve.service';
import { isObject, localizedText, text } from './variant-normalization';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

@Injectable()
export class TiendanubeSaleIngestionService {
  private readonly logger = new Logger(TiendanubeSaleIngestionService.name);

  constructor(
    private readonly connections: TiendanubeConnectionRepository,
    private readonly api: TiendanubeApiService,
    private readonly sales: RecentSalesRepository,
    private readonly links: VariantChannelLinksRepository,
  ) {}

  receive(orderId: string, storeId: string): void {
    void this.process(orderId, storeId).catch(() => {
      this.logger.warn(`No se pudo registrar la orden ${orderId}`);
    });
  }

  async process(orderId: string, storeId: string): Promise<void> {
    const connection = await this.connections.findCredentialsByStoreId(storeId);
    if (!connection) return;
    const order = await this.api.get<unknown>(
      storeId,
      `/orders/${encodeURIComponent(orderId)}`,
      connection.accessToken,
    );
    if (
      !isObject(order) ||
      text(order.id) !== orderId ||
      order.payment_status !== 'paid'
    )
      return;
    const soldAt = timestamp(order.paid_at) ?? timestamp(order.created_at);
    if (!soldAt) return;
    const products = Array.isArray(order.products)
      ? order.products.filter(isObject)
      : [];
    const productIds = [
      ...new Set(products.flatMap((line) => text(line.product_id) ?? [])),
    ];
    const [links, productResults] = await Promise.all([
      this.links.findByUserId(connection.userId),
      Promise.allSettled(
        productIds.map((productId) =>
          this.api.get<unknown>(
            storeId,
            `/products/${encodeURIComponent(productId)}`,
            connection.accessToken,
          ),
        ),
      ),
    ]);
    const currentProducts = new Map(
      productResults.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? [
              [
                productIds[index],
                mapTiendanubeProduct(result.value, productIds[index]),
              ],
            ]
          : [],
      ),
    );
    const records = products.flatMap((line) => {
      const productId = text(line.product_id);
      const variantId = text(line.variant_id);
      const quantity = positiveInteger(line.quantity);
      if (!productId || !variantId || !quantity) return [];
      const linked = findTnLink(links, productId, variantId);
      const current = currentProducts
        .get(productId)
        ?.find((variant) => variant.tiendaNube?.variantId === variantId);
      const values = variantValues(line.variant_values);
      return [
        {
          userId: connection.userId,
          channel: 'TIENDANUBE',
          externalOrderId: orderId,
          externalOrderItemId: text(line.id) ?? `${productId}:${variantId}`,
          soldAt,
          quantity,
          productName: text(line.name) ?? productId,
          sku: text(line.sku) ?? current?.sku ?? linked?.sku ?? null,
          mlItemId: linked?.mlItemId ?? null,
          mlVariationId: linked?.mlVariationId ?? null,
          userProductId: linked?.userProductId ?? null,
          familyId: linked?.familyId ?? null,
          tnProductId: productId,
          tnVariantId: variantId,
          color: current?.color ?? values[0] ?? null,
          size: current?.size ?? values[1] ?? null,
          mappingStatus: linked ? 'LINKED' : 'UNLINKED',
        } satisfies SaveRecentSale,
      ];
    });
    await this.sales.saveMany(records);
  }
}

function variantValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(localizedText)
      .filter((part): part is string => part !== null);
  }
  const serialized = text(value);
  return serialized
    ? serialized
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function findTnLink(
  links: VariantChannelLink[],
  productId: string,
  variantId: string,
): VariantChannelLink | null {
  return (
    links.find(
      (link) =>
        link.tnProductId === productId && link.tnVariantId === variantId,
    ) ?? null
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
