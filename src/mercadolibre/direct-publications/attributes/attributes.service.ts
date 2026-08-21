import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import type { MlAttribute, MlItem } from '../items/items.types';

import { PublicationsMapper } from '../publications/publications.mapper';

import type { AttributeInput, AttributeUpdate } from './attributes.types';

type MlVariationAttribute = {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  values?: Array<{
    id?: string | null;
    name?: string | null;
  }>;
};

type MlVariation = {
  id: number | string;

  sold_quantity?: number;

  attributes?: MlVariationAttribute[];

  attribute_combinations?: MlVariationAttribute[];
};

@Injectable()
export class AttributesService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,

    private readonly apiService: MercadolibreApiService,
  ) {}

  /**
   * Lee atributos de publicación clásica.
   */
  async getClassic(itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return {
      model: 'SHARED',

      itemId: item.id,

      categoryId: item.category_id ?? null,

      attributes: item.attributes ?? [],

      variations: this.getVariations(item.variations).map((variation) => ({
        id: variation.id,

        soldQuantity: variation.sold_quantity ?? 0,

        attributeCombinations: variation.attribute_combinations ?? [],

        attributes: variation.attributes ?? [],
      })),
    };
  }

  /**
   * Edita atributo general de clásica.
   */
  async updateClassicItemAttribute(itemId: string, changes: AttributeUpdate) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const attribute = this.normalizeAttribute(changes.attribute);

    const attributes = this.mergeAttribute(item.attributes ?? [], attribute);

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        attributes,
      },
      accessToken,
    );
  }

  /**
   * Edita atributo propio de una variación clásica.
   * Ejemplo: EAN, SELLER_SKU, etc.
   */
  async updateClassicVariationAttribute(
    itemId: string,
    variationId: string,
    changes: AttributeUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const variations = this.getVariations(item.variations);

    const target = this.findVariation(variations, variationId);

    const attribute = this.normalizeAttribute(changes.attribute);

    const attributes = this.mergeAttribute(target.attributes ?? [], attribute);

    const payload = variations.map((variation) => {
      if (String(variation.id) !== variationId) {
        return {
          id: variation.id,
        };
      }

      return {
        id: variation.id,
        attributes,
      };
    });

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        variations: payload,
      },
      accessToken,
    );
  }

  /**
   * Edita atributo por el que varía una clásica.
   * Ejemplo: COLOR o SIZE.
   */
  async updateClassicCombination(
    itemId: string,
    variationId: string,
    changes: AttributeUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    const variations = this.getVariations(item.variations);

    const target = this.findVariation(variations, variationId);

    if ((target.sold_quantity ?? 0) > 0) {
      throw new BadRequestException(
        'No modificamos atributos de combinación de una variación que ya tiene ventas',
      );
    }

    const attribute = this.normalizeAttribute(changes.attribute);

    const combinations = this.mergeAttribute(
      target.attribute_combinations ?? [],
      attribute,
    );

    const payload = variations.map((variation) => {
      if (String(variation.id) !== variationId) {
        return {
          id: variation.id,
        };
      }

      return {
        id: variation.id,

        attribute_combinations: combinations,
      };
    });

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        variations: payload,
      },
      accessToken,
    );
  }

  /**
   * Lee atributos de publicación nueva.
   */
  async getNew(familyId: string, itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    this.validateNew(familyId, item);

    return {
      model: 'VARIANT_PRICING',

      familyId,

      itemId: item.id,

      userProductId: item.user_product_id ?? null,

      categoryId: item.category_id ?? null,

      attributes: item.attributes ?? [],
    };
  }

  /**
   * Edita un atributo del User Product nuevo.
   */
  async updateNewAttribute(
    familyId: string,
    itemId: string,
    changes: AttributeUpdate,
  ) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.getItemWithAttributes(itemId, accessToken);

    this.validateNew(familyId, item);

    const attribute = this.normalizeAttribute(changes.attribute);

    const attributes = this.mergeAttribute(item.attributes ?? [], attribute);

    return this.apiService.put<MlItem>(
      `/items/${item.id}`,
      {
        attributes,
      },
      accessToken,
    );
  }

  private getItemWithAttributes(
    itemId: string,
    accessToken: string,
  ): Promise<MlItem> {
    return this.apiService.get<MlItem>(
      `/items/${itemId}?include_attributes=all`,
      accessToken,
    );
  }

  private normalizeAttribute(attribute: AttributeInput): MlAttribute {
    if (
      !attribute ||
      typeof attribute.id !== 'string' ||
      !attribute.id.trim()
    ) {
      throw new BadRequestException('Atributo inválido');
    }

    const hasValueId = Object.prototype.hasOwnProperty.call(
      attribute,
      'valueId',
    );

    const hasValueName = Object.prototype.hasOwnProperty.call(
      attribute,
      'valueName',
    );

    const hasValues = Array.isArray(attribute.values);

    if (!hasValueId && !hasValueName && !hasValues) {
      throw new BadRequestException('Debes enviar valueId, valueName o values');
    }

    return {
      id: attribute.id.trim(),

      ...(hasValueId
        ? {
            value_id: attribute.valueId ?? null,
          }
        : {}),

      ...(hasValueName
        ? {
            value_name: attribute.valueName ?? null,
          }
        : {}),

      ...(hasValues
        ? {
            values: attribute.values,
          }
        : {}),
    };
  }

  private mergeAttribute<
    T extends {
      id: string;
    },
  >(current: T[], attribute: MlAttribute): Array<T | MlAttribute> {
    const index = current.findIndex((item) => item.id === attribute.id);

    if (index < 0) {
      return [...current, attribute];
    }

    return current.map((item, itemIndex) =>
      itemIndex === index
        ? {
            ...item,
            ...attribute,
          }
        : item,
    );
  }

  private getVariations(variations: unknown[] | undefined): MlVariation[] {
    if (!Array.isArray(variations)) {
      return [];
    }

    return variations.filter(
      (variation): variation is MlVariation =>
        typeof variation === 'object' &&
        variation !== null &&
        'id' in variation,
    );
  }

  private findVariation(
    variations: MlVariation[],
    variationId: string,
  ): MlVariation {
    const variation = variations.find(
      (item) => String(item.id) === variationId,
    );

    if (!variation) {
      throw new BadRequestException('La variación indicada no existe');
    }

    return variation;
  }

  private validateNew(familyId: string, item: MlItem): void {
    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    if (String(item.family_id ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }

    if (!item.user_product_id) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }
  }
}
