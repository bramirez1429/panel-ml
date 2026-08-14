import { Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import {
  discountPercentage,
  normalizePricesResponse,
  normalizeSalePrice,
  selectPrice,
} from './publication-prices.helpers';

@Injectable()
export class PublicationPricesService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Lee /prices y /sale_price oficiales luego de validar ownership vivo. */
  async get(productId: string, requestedItemId: unknown) {
    const contexts =
      requestedItemId === undefined
        ? await this.targets.resolveAll(productId)
        : [await this.targets.resolve(productId, requestedItemId)];
    const targets = await Promise.all(
      contexts.map((context) => this.readTarget(context)),
    );
    return {
      productId,
      summary: summarize(targets),
      targets,
    };
  }

  /** Consulta el precio oficial de un MLA ya validado para el seller. */
  async readTarget(
    context: Awaited<ReturnType<PublicationManagementTargetService['resolve']>>,
  ) {
    await this.targets.getOwnedItem(context);
    const itemId = context.target.itemId;
    const [pricesResponse, salePriceResponse] = await Promise.all([
      this.apiService.get<unknown>(
        `/items/${encodeURIComponent(itemId)}/prices`,
        context.accessToken,
      ),
      this.apiService.get<unknown>(
        `/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`,
        context.accessToken,
      ),
    ]);
    const prices = normalizePricesResponse(pricesResponse, itemId);
    const sale = normalizeSalePrice(salePriceResponse);
    const standard = selectPrice(prices, 'standard');
    const promotion = selectPrice(prices, 'promotion');
    const regularPrice =
      sale.regularAmount ??
      promotion?.regularAmount ??
      standard?.amount ??
      null;
    const promoted = Boolean(
      sale.promotionId || sale.promotionType || promotion,
    );
    const summary = {
      standardPrice: standard?.amount ?? null,
      salePrice: sale.amount,
      regularPrice,
      promotionPrice: promoted ? sale.amount : null,
      promotionPercentage: promoted
        ? discountPercentage(regularPrice, sale.amount)
        : null,
      promotionId: sale.promotionId ?? promotion?.promotionId ?? null,
      promotionType: sale.promotionType ?? promotion?.promotionType ?? null,
      promotionStatus: null,
      promotionStartDate: promotion?.startDate ?? null,
      promotionEndDate: promotion?.endDate ?? null,
    };
    return {
      itemId,
      variationId: null,
      userProductId: context.target.userProductId,
      currencyId: sale.currencyId ?? standard?.currencyId ?? null,
      ...summary,
      officialPrices: prices,
    };
  }
}

type PriceTarget = Awaited<ReturnType<PublicationPricesService['readTarget']>>;

function summarize(targets: PriceTarget[]) {
  const first = targets[0];
  const minimum = (field: keyof PriceTarget): number | null => {
    const values = targets.flatMap((target) => {
      const value = target[field];
      return typeof value === 'number' ? [value] : [];
    });
    return values.length ? Math.min(...values) : null;
  };
  return {
    itemId: targets.length === 1 ? (first?.itemId ?? null) : null,
    variationId: null,
    userProductId: targets.length === 1 ? (first?.userProductId ?? null) : null,
    currencyId: first?.currencyId ?? null,
    standardPrice: minimum('standardPrice'),
    salePrice: minimum('salePrice'),
    regularPrice: minimum('regularPrice'),
    promotionPrice: minimum('promotionPrice'),
    promotionPercentage: first?.promotionPercentage ?? null,
    promotionId: first?.promotionId ?? null,
    promotionType: first?.promotionType ?? null,
    promotionStatus: first?.promotionStatus ?? null,
    promotionStartDate: first?.promotionStartDate ?? null,
    promotionEndDate: first?.promotionEndDate ?? null,
  };
}
