import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecentSalesRepository } from './recent-sales.repository';
import { SalesCurveService } from './sales-curve.service';
import type { DetailedVariant, RecentSale } from './sales.types';
import {
  RECENT_SALES_DEFAULT_HOURS,
  RECENT_SALES_MAX_HOURS,
} from './sales.types';

const DETAIL_CONCURRENCY = 8;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class RecentSalesService {
  constructor(
    private readonly sales: RecentSalesRepository,
    private readonly curves: SalesCurveService,
  ) {}

  async list(userId: string, hoursInput?: unknown) {
    const hours = parseHours(hoursInput);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const sales = await this.sales.findSince(since);
    const items: ReturnType<typeof summarize>[] = [];

    for (let index = 0; index < sales.length; index += DETAIL_CONCURRENCY) {
      const batch = sales.slice(index, index + DETAIL_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((sale) => this.curves.getForSale(userId, sale)),
      );
      items.push(
        ...batch.map((sale, offset) => {
          const result = results[offset];
          return summarize(
            sale,
            result.status === 'fulfilled' ? result.value : [],
          );
        }),
      );
    }

    return { hours, items };
  }

  async detail(userId: string, saleId: string) {
    if (!UUID_PATTERN.test(saleId)) {
      throw new BadRequestException('saleId inválido');
    }
    const sale = await this.sales.findById(saleId);
    if (!sale) throw new NotFoundException('Venta no encontrada');
    const variants = await this.curves.getForSale(userId, sale);
    return { sale: publicSale(sale), variants };
  }
}

function parseHours(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return RECENT_SALES_DEFAULT_HOURS;
  }
  const hours = typeof value === 'string' ? Number(value) : value;
  if (
    typeof hours !== 'number' ||
    !Number.isSafeInteger(hours) ||
    hours < 1 ||
    hours > RECENT_SALES_MAX_HOURS
  ) {
    throw new BadRequestException(
      `hours debe ser un entero entre 1 y ${RECENT_SALES_MAX_HOURS}`,
    );
  }
  return hours;
}

function summarize(sale: RecentSale, variants: DetailedVariant[]) {
  const sold = variants.find((variant) => matchesSale(variant, sale));
  return {
    saleId: sale.id,
    channel: sale.channel,
    soldAt: sale.soldAt,
    quantity: sale.quantity,
    productName: sale.productName,
    sku: sale.sku,
    mlItemId: sale.mlItemId ?? sold?.ml?.itemId ?? null,
    mlVariationId: sale.mlVariationId ?? sold?.ml?.variationId ?? null,
    userProductId: sale.userProductId ?? sold?.ml?.userProductId ?? null,
    familyId: sale.familyId ?? sold?.ml?.familyId ?? null,
    tnProductId: sale.tnProductId ?? sold?.tiendaNube?.productId ?? null,
    tnVariantId: sale.tnVariantId ?? sold?.tiendaNube?.variantId ?? null,
    color: sale.color ?? sold?.color ?? null,
    size: sale.size ?? sold?.size ?? null,
    mlStock: sold?.ml?.stock ?? null,
    tiendaNubeStock: sold?.tiendaNube?.stock ?? null,
    stockDifference: sold?.stockDifference ?? null,
    mappingStatus: sold?.mappingStatus ?? sale.mappingStatus,
    lowStockCount: variants.filter(
      ({ stockStatus }) =>
        stockStatus === 'LOW' || stockStatus === 'OUT_OF_STOCK',
    ).length,
    hasStockDifference: sold?.hasStockDifference ?? null,
  };
}

function matchesSale(variant: DetailedVariant, sale: RecentSale): boolean {
  if (sale.mlItemId) {
    return Boolean(
      variant.ml?.itemId === sale.mlItemId &&
      variant.ml.variationId === sale.mlVariationId,
    );
  }
  return Boolean(
    variant.tiendaNube?.productId === sale.tnProductId &&
    variant.tiendaNube?.variantId === sale.tnVariantId,
  );
}

function publicSale({ userId, ...sale }: RecentSale) {
  void userId;
  return sale;
}
