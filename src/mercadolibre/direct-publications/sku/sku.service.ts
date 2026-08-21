import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';
import type { MlItem } from '../items/items.types';

import type { ClassicSkuUpdate, NewSkuUpdate } from './sku.types';

type VariationAttribute = {
  id?: string;
  value_id?: string | null;
  value_name?: string | null;
  [key: string]: unknown;
};

type ClassicVariation = {
  id?: number | string;
  attributes?: VariationAttribute[];
  [key: string]: unknown;
};

@Injectable()
export class SkuService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  /**
   * Consulta SKU de una publicación clásica.
   */
  async getClassicSku(itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getClassicItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const variations = this.getVariations(item.variations);

    if (variations.length > 0) {
      return {
        model: 'SHARED',
        itemId: item.id,
        hasVariations: true,

        variations: variations.map((variation) => ({
          variationId: variation.id ?? null,
          sku: this.findSku(variation.attributes),
        })),
      };
    }

    return {
      model: 'SHARED',
      itemId: item.id,
      hasVariations: false,
      sku: this.findSku(item.attributes),
    };
  }

  /**
   * Modifica SKU de una publicación clásica.
   *
   * Si tiene variaciones, variationId es obligatorio.
   */
  async updateClassicSku(itemId: string, changes: ClassicSkuUpdate) {
    const sku = this.validateSku(changes.sku);

    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getClassicItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const variations = this.getVariations(item.variations);

    /*
     * CLÁSICA CON VARIACIONES
     */
    if (variations.length > 0) {
      if (changes.variationId === undefined) {
        throw new BadRequestException(
          'Esta publicación tiene variaciones: variationId es obligatorio',
        );
      }

      const targetVariation = variations.find(
        (variation) => String(variation.id) === String(changes.variationId),
      );

      if (!targetVariation) {
        throw new BadRequestException(
          'La variación indicada no existe en la publicación',
        );
      }

      const payloadVariations = variations.map((variation) => {
        if (String(variation.id) !== String(changes.variationId)) {
          return {
            id: variation.id,
          };
        }

        return {
          id: variation.id,
          attributes: this.mergeSkuAttribute(variation.attributes, sku),
        };
      });

      return this.apiService.put(
        `/items/${item.id}`,
        {
          variations: payloadVariations,
        },
        accessToken,
      );
    }

    /*
     * CLÁSICA SIN VARIACIONES
     */
    return this.apiService.put(
      `/items/${item.id}`,
      {
        attributes: this.mergeSkuAttribute(item.attributes, sku),
      },
      accessToken,
    );
  }

  /**
   * Consulta SKU de un MLA del modelo nuevo.
   */
  async getNewSku(familyId: string, itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    this.validateFamily(familyId, item.family_id);

    return {
      model: 'VARIANT_PRICING',
      familyId,
      itemId: item.id,
      userProductId: item.user_product_id ?? null,
      sku: this.findSku(item.attributes),
    };
  }

  /**
   * Modifica SKU de un User Product mediante su MLA.
   */
  async updateNewSku(familyId: string, itemId: string, changes: NewSkuUpdate) {
    const sku = this.validateSku(changes.sku);

    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    this.validateFamily(familyId, item.family_id);

    if (!item.user_product_id) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }

    return this.apiService.put(
      `/items/${item.id}`,
      {
        attributes: this.mergeSkuAttribute(item.attributes, sku),
      },
      accessToken,
    );
  }

  /**
   * Agrega o reemplaza SELLER_SKU
   * conservando los demás atributos.
   */
  private mergeSkuAttribute(
    attributes: VariationAttribute[] | undefined,
    sku: string,
  ): VariationAttribute[] {
    const current = Array.isArray(attributes) ? [...attributes] : [];

    const existingIndex = current.findIndex(
      (attribute) => attribute.id === 'SELLER_SKU',
    );

    const sellerSku: VariationAttribute = {
      id: 'SELLER_SKU',
      value_name: sku,
    };

    if (existingIndex >= 0) {
      current[existingIndex] = {
        ...current[existingIndex],
        ...sellerSku,
      };

      return current;
    }

    return [...current, sellerSku];
  }

  /**
   * Obtiene SELLER_SKU.
   */
  private findSku(attributes: VariationAttribute[] | undefined): string | null {
    if (!Array.isArray(attributes)) {
      return null;
    }

    const attribute = attributes.find((item) => item.id === 'SELLER_SKU');

    if (!attribute || typeof attribute.value_name !== 'string') {
      return null;
    }

    return attribute.value_name;
  }

  private getVariations(variations: unknown[] | undefined): ClassicVariation[] {
    if (!Array.isArray(variations)) {
      return [];
    }

    return variations.filter(
      (variation): variation is ClassicVariation =>
        typeof variation === 'object' &&
        variation !== null &&
        'id' in variation,
    );
  }

  private validateSku(sku: string): string {
    if (typeof sku !== 'string' || !sku.trim()) {
      throw new BadRequestException('SKU inválido');
    }

    return sku.trim();
  }

  private validateFamily(
    familyId: string,
    itemFamilyId: string | number | null | undefined,
  ): void {
    if (String(itemFamilyId ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }
  }

  private async getClassicItemWithAttributes(
    itemId: string,
    accessToken: string,
  ) {
    return this.apiService.get<MlItem>(
      `/items/${itemId}?include_attributes=all`,
      accessToken,
    );
  }
}
