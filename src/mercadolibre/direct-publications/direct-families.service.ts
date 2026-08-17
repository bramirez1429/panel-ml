import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';

import {
  Attribute,
  FamilyResponse,
  MercadoLibreItem,
  MultiGetResponse,
  PricesResponse,
  Promotion,
  SalePriceResponse,
  SearchResponse,
} from './direct-families.types';

@Injectable()
export class DirectFamiliesService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Trae toda una familia nueva directamente desde Mercado Libre. */
  async getFamily(familyId: string) {
    this.validateFamilyId(familyId);

    const connection =
      await this.tokenService.getStoredConnection();

    // 1. Obtener todos los User Products de la familia.
    const family = await this.apiService.get<FamilyResponse>(
      `/sites/MLA/user-products-families/${familyId}`,
      connection.access_token,
    );

    if (
      String(family.user_id) !==
      String(connection.seller_id)
    ) {
      throw new ForbiddenException(
        'La familia no pertenece al seller conectado',
      );
    }

    // 2. Buscar todos los MLA asociados a esos User Products.
    const itemIds = await this.getItemIds(
      family.user_products_ids,
      connection.seller_id,
      connection.access_token,
    );

    // 3. Obtener detalle de los MLA mediante Multiget.
    const items = await this.getItems(
      itemIds,
      connection.access_token,
    );

    // 4. Enriquecer cada MLA con precios + sale price + promociones.
    const variants = [];

    // Concurrencia baja para evitar castigar la API de Mercado Libre.
    for (const batch of this.chunk(items, 2)) {
      const result = await Promise.all(
        batch.map((item) =>
          this.enrichItem(
            item,
            connection.access_token,
          ),
        ),
      );

      variants.push(...result);
    }

    return {
      familyId: String(family.family_id),

      familyName:
        items.find((item) => item.family_name)
          ?.family_name ?? null,

      siteId: family.site_id,
      sellerId: family.user_id,

      userProductsCount:
        family.user_products_ids.length,

      itemsCount: items.length,

      userProductIds:
        family.user_products_ids,

      variants,
    };
  }

  /** Busca todos los MLA pertenecientes a los User Products. */
  private async getItemIds(
    userProductIds: string[],
    sellerId: string | number,
    accessToken: string,
  ) {
    const ids = new Set<string>();

    // Evitamos una URL gigante.
    for (const userProducts of this.chunk(
      userProductIds,
      20,
    )) {
      const value = userProducts.join(',');

      let offset = 0;
      let total = 0;

      do {
        const search =
          await this.apiService.get<SearchResponse>(
            `/users/${sellerId}/items/search` +
              `?user_product_id=${value}` +
              `&limit=100` +
              `&offset=${offset}`,
            accessToken,
          );

        search.results.forEach((id) => ids.add(id));

        total = search.paging.total;
        offset += search.paging.limit;
      } while (offset < total);
    }

    return [...ids];
  }

  /** Obtiene el detalle de los MLA en bloques de 20. */
  private async getItems(
    itemIds: string[],
    accessToken: string,
  ) {
    const result: MercadoLibreItem[] = [];

    for (const ids of this.chunk(itemIds, 20)) {
      const response =
        await this.apiService.get<MultiGetResponse[]>(
          `/items?ids=${ids.join(',')}`,
          accessToken,
        );

      const validItems = response
        .filter((item) => item.code === 200)
        .map((item) => item.body);

      result.push(...validItems);
    }

    return result;
  }

  /** Agrega precios, promociones y estructura administrativa. */
  private async enrichItem(
    item: MercadoLibreItem,
    accessToken: string,
  ) {
    const [prices, salePrice, promotions] =
      await Promise.all([
        this.safeGet<PricesResponse | null>(
          `/items/${item.id}/prices`,
          accessToken,
          null,
        ),

        this.safeGet<SalePriceResponse | null>(
          `/items/${item.id}/sale_price?context=channel_marketplace`,
          accessToken,
          null,
        ),

        this.safeGet<Promotion[]>(
          `/seller-promotions/items/${item.id}?app_version=v2`,
          accessToken,
          [],
        ),
      ]);

    const standardPrice =
      prices?.prices?.find(
        (price) =>
          price.type === 'standard' &&
          (
            !price.conditions
              ?.context_restrictions?.length ||
            price.conditions.context_restrictions.includes(
              'channel_marketplace',
            )
          ),
      ) ??
      prices?.prices?.find(
        (price) => price.type === 'standard',
      );

    const promotionPrice =
      prices?.prices?.find(
        (price) =>
          price.type === 'promotion' &&
          price.conditions?.context_restrictions?.includes(
            'channel_marketplace',
          ),
      ) ??
      prices?.prices?.find(
        (price) => price.type === 'promotion',
      );

    const attributes = item.attributes ?? [];

    const sellerSku =
      this.getAttributeValue(
        attributes,
        'SELLER_SKU',
      );

    const color =
      this.getAttributeValue(attributes, 'COLOR');

    const size =
      this.getAttributeValue(attributes, 'SIZE');

    const fabricDesign =
      this.getAttributeValue(
        attributes,
        'FABRIC_DESIGN',
      );

    const printDesign =
      this.getAttributeValue(
        attributes,
        'PRINT_DESIGN',
      );

    const activePromotions =
      promotions.filter(
        (promotion) =>
          promotion.status === 'started',
      );

    const candidatePromotions =
      promotions.filter(
        (promotion) =>
          promotion.status === 'candidate',
      );

    const pendingPromotions =
      promotions.filter(
        (promotion) =>
          promotion.status === 'pending',
      );

    return {
      identification: {
        itemId: item.id,
        userProductId:
          item.user_product_id ?? null,
        familyId:
          item.family_id ?? null,
      },

      product: {
        title: item.title ?? null,

        categoryId:
          item.category_id ?? null,

        domainId:
          item.domain_id ?? null,

        condition:
          item.condition ?? null,

        permalink:
          item.permalink ?? null,

        warranty:
          item.warranty ?? null,

        catalogProductId:
          item.catalog_product_id ?? null,

        health:
          item.health ?? null,
      },

      variant: {
        color,
        size,
        fabricDesign,
        printDesign,
      },

      stock: {
        available:
          item.available_quantity ?? 0,

        initial:
          item.initial_quantity ?? 0,

        sold:
          item.sold_quantity ?? 0,
      },

      sku: {
        sellerSku,
        sellerCustomField:
          item.seller_custom_field ?? null,

        inventoryId:
          item.inventory_id ?? null,
      },

      price: {
        standard:
          standardPrice?.amount ??
          item.price ??
          null,

        current:
          salePrice?.amount ??
          promotionPrice?.amount ??
          item.price ??
          null,

        regular:
          salePrice?.regular_amount ??
          promotionPrice?.regular_amount ??
          null,

        currency:
          salePrice?.currency_id ??
          standardPrice?.currency_id ??
          item.currency_id ??
          null,

        hasPromotion:
          Boolean(
            salePrice?.regular_amount &&
            salePrice?.amount &&
            salePrice.amount <
              salePrice.regular_amount,
          ),

        metadata:
          salePrice?.metadata ?? {},

        salePrice,

        allPrices:
          prices?.prices ?? [],
      },

      promotions: {
        active: activePromotions,
        candidates: candidatePromotions,
        pending: pendingPromotions,
        all: promotions,
      },

      images: {
        thumbnail:
          item.thumbnail ?? null,

        pictures:
          item.pictures ?? [],
      },

      status: {
        status:
          item.status ?? null,

        subStatus:
          item.sub_status ?? [],
      },

      shipping: {
        mode:
          item.shipping?.mode ?? null,

        freeShipping:
          item.shipping?.free_shipping ??
          false,

        logisticType:
          item.shipping?.logistic_type ??
          null,

        localPickUp:
          item.shipping?.local_pick_up ??
          false,

        storePickUp:
          item.shipping?.store_pick_up ??
          false,

        tags:
          item.shipping?.tags ?? [],
      },

      listing: {
        listingTypeId:
          item.listing_type_id ?? null,

        channels:
          item.channels ?? [],

        tags:
          item.tags ?? [],
      },

      dates: {
        created:
          item.date_created ?? null,

        updated:
          item.last_updated ?? null,
      },

      saleTerms:
        item.sale_terms ?? [],

      // Guardamos todos los atributos.
      // Nos sirve para futuras funcionalidades.
      attributes,
    };
  }

  /** Consulta auxiliar que no rompe toda la familia si un recurso falla. */
  private async safeGet<T>(
    path: string,
    accessToken: string,
    defaultValue: T,
  ): Promise<T> {
    try {
      return await this.apiService.get<T>(
        path,
        accessToken,
      );
    } catch {
      return defaultValue;
    }
  }

  /** Obtiene rápidamente un atributo por ID. */
  private getAttributeValue(
    attributes: Attribute[],
    id: string,
  ): string | null {
    const attribute = attributes.find(
      (item) => item.id === id,
    );

    return (
      attribute?.value_name ??
      attribute?.values?.[0]?.name ??
      null
    );
  }

  private validateFamilyId(
    familyId: string,
  ) {
    if (!/^\d+$/.test(familyId)) {
      throw new BadRequestException(
        'familyId inválido',
      );
    }
  }

  /** Divide arrays en bloques. */
  private chunk<T>(
    items: T[],
    size: number,
  ): T[][] {
    const result: T[][] = [];

    for (
      let index = 0;
      index < items.length;
      index += size
    ) {
      result.push(
        items.slice(index, index + size),
      );
    }

    return result;
  }
}