import { BadRequestException, HttpException, Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { isIdentifierAttribute } from './similar-publication.mapper';
import type {
  SimilarPublicationAttribute,
  SimilarPublicationCreatedItem,
  SimilarPublicationCreateInput,
  SimilarPublicationCreationCategoryRules,
  SimilarPublicationCreationResult,
  SimilarPublicationDraft,
  SimilarPublicationErrorCause,
  SimilarPublicationSaleTerm,
} from './similar-publication.types';
import { SimilarPublicationSourceService } from './similar-publication-source.service';
import { SimilarPublicationValidationService } from './similar-publication-validation.service';

@Injectable()
export class SimilarPublicationCreationService {
  constructor(
    private readonly sourceService: SimilarPublicationSourceService,
    private readonly validationService: SimilarPublicationValidationService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  async create(
    userId: string,
    rawInput: unknown,
  ): Promise<SimilarPublicationCreationResult> {
    const input = this.validationService.parse(rawInput);
    const source = await this.sourceService.load(userId, input.sourceKey);

    const completedInput = withSourceDefaults(
      input,
      source.draft,
    );

    this.validationService.validateNewData(
      completedInput,
      source.originalIdentifierValues,
      source.originalPictureIds,
    );

    const categoryRules = await this.validationService.validateCategory(
      completedInput,
      source.accessToken,
    );

    const creationInput = withPackageAttributes(
      completedInput,
      categoryRules,
    );
    const sellerUsesUserProducts =
      await this.sourceService.sellerUsesUserProducts(
        source.sellerId,
        source.accessToken,
      );
    const useUserProducts =
      sellerUsesUserProducts || source.draft.sourceType === 'USER_PRODUCT';

    if (useUserProducts) {
      this.validateFamilyName(
        creationInput.familyName,
        source.draft.familyName,
      );
      return this.createUserProducts(creationInput, source.accessToken);
    }
    return this.createLegacy(creationInput, source.accessToken);
  }

  private async createUserProducts(
    input: SimilarPublicationCreateInput,
    accessToken: string,
  ): Promise<SimilarPublicationCreationResult> {
    const results: SimilarPublicationCreatedItem[] = [];
    for (const variant of input.variants) {
      const payload = {
        family_name: input.familyName,
        category_id: input.categoryId,
        price: variant.price,
        currency_id: input.currencyId,
        available_quantity: variant.stock,
        buying_mode: input.buyingMode,
        listing_type_id: input.listingTypeId,
        ...(input.condition ? { condition: input.condition.id } : {}),
        pictures: variant.pictureIds.map((id) => ({ id })),
        attributes: withSku(variant.attributes, variant.sku).map(toMlAttribute),
        sale_terms: input.saleTerms.map(toMlSaleTerm),
        ...(input.shipping
          ? { shipping: { free_shipping: input.shipping.freeShipping } }
          : {}),
        ...(input.channels.length > 0 ? { channels: input.channels } : {}),
      };
      results.push(
        await this.createOne(
          variant.sourceReference,
          payload,
          input.description,
          accessToken,
        ),
      );
    }
    return summarize(results);
  }

  private async createLegacy(
    input: SimilarPublicationCreateInput,
    accessToken: string,
  ): Promise<SimilarPublicationCreationResult> {
    if (!input.titleTemplate) {
      throw new BadRequestException(
        'El título es obligatorio para publicar en Legacy',
      );
    }
    const allPictures = [
      ...new Set(input.variants.flatMap(({ pictureIds }) => pictureIds)),
    ];
    const commonAttributes = commonAttributesFor(input);
    const base = {
      title: input.titleTemplate,
      category_id: input.categoryId,
      price: input.variants[0].price,
      currency_id: input.currencyId,
      buying_mode: input.buyingMode,
      listing_type_id: input.listingTypeId,
      ...(input.condition ? { condition: input.condition.id } : {}),
      pictures: allPictures.map((id) => ({ id })),
      attributes: commonAttributes.map(toMlAttribute),
      sale_terms: input.saleTerms.map(toMlSaleTerm),
      ...(input.shipping
        ? { shipping: { free_shipping: input.shipping.freeShipping } }
        : {}),
      ...(input.channels.length > 0 ? { channels: input.channels } : {}),
    };
    const payload =
      input.variants.length === 1
        ? {
            ...base,
            available_quantity: input.variants[0].stock,
            attributes: withSku(
              input.variants[0].attributes,
              input.variants[0].sku,
            ).map(toMlAttribute),
          }
        : {
            ...base,
            variations: input.variants.map((variant) => ({
              price: variant.price,
              available_quantity: variant.stock,
              attribute_combinations: differentAttributes(
                variant.attributes,
                commonAttributes,
              ).map(toMlAttribute),
              attributes: variant.sku
                ? [toMlAttribute(skuAttribute(variant.sku))]
                : [],
              picture_ids: variant.pictureIds,
            })),
          };
    const result = await this.createOne(
      input.variants[0].sourceReference,
      payload,
      input.description,
      accessToken,
    );
    return summarize([result]);
  }

  private async createOne(
    variantKey: string,
    payload: unknown,
    description: string | null,
    accessToken: string,
  ): Promise<SimilarPublicationCreatedItem> {
    let itemId: string | null = null;
    let userProductId: string | null = null;
    let familyId: string | null = null;
    try {
      const response = await this.apiService.post<unknown>(
        '/items',
        payload,
        accessToken,
      );
      if (!isJsonObject(response) || !validItemId(response.id)) {
        throw new BadRequestException('Mercado Libre no informó el nuevo MLA');
      }
      itemId = response.id;
      userProductId = text(response.user_product_id);
      familyId = identifier(response.family_id);
      if (description) {
        await this.apiService.post(
          `/items/${encodeURIComponent(itemId)}/description`,
          { plain_text: description },
          accessToken,
        );
      }
      return {
        variantKey,
        status: 'CREATED',
        itemId,
        userProductId,
        familyId,
        error: null,
      };
    } catch (error) {
      return {
        variantKey,
        status: 'ERROR',
        itemId,
        userProductId,
        familyId,
        error: safeError(error),
      };
    }
  }

  private validateFamilyName(
    familyName: string | null,
    originalFamilyName: string | null,
  ): void {
    if (!familyName) {
      throw new BadRequestException(
        'familyName es obligatorio para User Products',
      );
    }
    if (
      originalFamilyName &&
      familyName.localeCompare(originalFamilyName, 'es', {
        sensitivity: 'base',
      }) === 0
    ) {
      throw new BadRequestException(
        'Modificá el nombre de la familia para crear una publicación similar.',
      );
    }
  }
}

function withSourceDefaults(
  input: SimilarPublicationCreateInput,
  source: SimilarPublicationDraft,
): SimilarPublicationCreateInput {
  const sourceVariants = new Map(
    source.variants.map((variant) => [
      variant.sourceReference,
      variant,
    ]),
  );

  const commonDefaults = mergePreferredAttributes(
    source.commonAttributes ?? [],
    source.mainAttributes ?? [],
  ).filter(
    (attribute) => !isIdentifierAttribute(attribute.id),
  );

  return {
    ...input,

    /*
     * La condición se hereda automáticamente de la
     * publicación original si el front no la envía.
     */
    condition:
      input.condition ??
      source.condition ??
      null,

    variants: input.variants.map((variant) => {
      const sourceVariant =
        sourceVariants.get(variant.sourceReference);

      const sourceAttributes =
        sourceVariant?.attributes ?? [];

      const defaults = mergePreferredAttributes(
        commonDefaults,
        sourceAttributes.filter(
          (attribute) =>
            !isIdentifierAttribute(attribute.id),
        ),
      );

      return {
        ...variant,

        /*
         * Los valores enviados por el usuario tienen prioridad.
         * Si vienen vacíos, conservamos el valor válido
         * de la publicación original.
         *
         * Nunca heredamos SKU / GTIN / EAN / UPC.
         */
        attributes: mergePreferredAttributes(
          defaults,
          variant.attributes,
        ),
      };
    }),
  };
}

function mergePreferredAttributes(
  ...groups: SimilarPublicationAttribute[][]
): SimilarPublicationAttribute[] {
  const result = new Map<
    string,
    SimilarPublicationAttribute
  >();

  for (const attribute of groups.flat()) {
    if (isIdentifierAttribute(attribute.id)) {
      /*
       * Un identificador solamente puede venir del
       * nuevo formulario. Nunca lo copiamos como default.
       */
      if (hasPayloadValue(attribute)) {
        result.set(attribute.id, attribute);
      }
      continue;
    }

    if (
      hasPayloadValue(attribute) ||
      !result.has(attribute.id)
    ) {
      result.set(attribute.id, attribute);
    }
  }

  return [...result.values()];
}

function summarize(
  items: SimilarPublicationCreatedItem[],
): SimilarPublicationCreationResult {
  const successful = items.filter(({ status }) => status === 'CREATED');
  const status =
    successful.length === items.length
      ? 'SUCCESS'
      : successful.length > 0
        ? 'PARTIAL'
        : 'FAILED';
  const sourceKey = newSourceKey(successful);
  return { status, items, sourceKey, newSourceKey: sourceKey };
}

function withPackageAttributes(
  input: SimilarPublicationCreateInput,
  rules: SimilarPublicationCreationCategoryRules,
): SimilarPublicationCreateInput {
  if (!input.package) return input;
  const ids = rules.packageAttributeIds;
  const packageIds = new Set(
    Object.values(ids).filter((id): id is string => id !== null),
  );
  const packageAttributes: SimilarPublicationAttribute[] = [];
  addMeasurement(packageAttributes, ids.width, input.package.widthCm, 'cm');
  addMeasurement(packageAttributes, ids.height, input.package.heightCm, 'cm');
  addMeasurement(packageAttributes, ids.length, input.package.lengthCm, 'cm');
  addMeasurement(
    packageAttributes,
    ids.weight,
    input.package.weightKg === null ? null : input.package.weightKg * 1000,
    'g',
  );
  return {
    ...input,
    variants: input.variants.map((variant) => ({
      ...variant,
      attributes: [
        ...variant.attributes.filter(({ id }) => !packageIds.has(id)),
        ...packageAttributes,
      ],
    })),
  };
}

function addMeasurement(
  target: SimilarPublicationAttribute[],
  id: string | null,
  value: number | null,
  unit: 'cm' | 'g',
): void {
  if (!id || value === null) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(
      `La medida ${id} debe convertirse a un entero positivo en ${unit}`,
    );
  }
  target.push({
    id,
    name: null,
    valueId: null,
    valueName: `${value} ${unit}`,
    values: [],
  });
}

function newSourceKey(items: SimilarPublicationCreatedItem[]): string | null {
  if (items.length === 0) return null;
  const familyIds = [
    ...new Set(items.flatMap(({ familyId }) => familyId ?? [])),
  ];
  if (familyIds.length === 1) return `family:${familyIds[0]}`;
  return items.length === 1 && items[0].itemId
    ? `item:${items[0].itemId}`
    : null;
}

function commonAttributesFor(
  input: SimilarPublicationCreateInput,
): SimilarPublicationAttribute[] {
  const [first, ...rest] = input.variants;
  return first.attributes.filter(
    (candidate) =>
      hasPayloadValue(candidate) &&
      rest.every((variant) =>
        variant.attributes.some(
          (attribute) =>
            attribute.id === candidate.id &&
            attributeSignature(attribute) === attributeSignature(candidate),
        ),
      ),
  );
}

function differentAttributes(
  attributes: SimilarPublicationAttribute[],
  common: SimilarPublicationAttribute[],
): SimilarPublicationAttribute[] {
  const ids = new Set(common.map(({ id }) => id));
  return attributes.filter(
    (attribute) =>
      !ids.has(attribute.id) &&
      attribute.id !== 'SELLER_SKU' &&
      hasPayloadValue(attribute),
  );
}

function attributeSignature(attribute: SimilarPublicationAttribute): string {
  return JSON.stringify({
    valueId: attribute.valueId,
    valueName: attribute.valueName,
    values: attribute.values,
  });
}

function withSku(
  attributes: SimilarPublicationAttribute[],
  sku: string | null,
): SimilarPublicationAttribute[] {
  const withoutSku = attributes.filter(
    (attribute) => attribute.id !== 'SELLER_SKU' && hasPayloadValue(attribute),
  );
  return sku ? [...withoutSku, skuAttribute(sku)] : withoutSku;
}

function hasPayloadValue(attribute: SimilarPublicationAttribute): boolean {
  return Boolean(
    attribute.valueId ||
    attribute.valueName ||
    attribute.values.some(({ id, name }) => Boolean(id || name)),
  );
}

function skuAttribute(value: string): SimilarPublicationAttribute {
  return {
    id: 'SELLER_SKU',
    name: null,
    valueId: null,
    valueName: value,
    values: [],
  };
}

function toMlAttribute(attribute: SimilarPublicationAttribute) {
  return {
    id: attribute.id,
    ...(attribute.valueId ? { value_id: attribute.valueId } : {}),
    ...(attribute.valueName ? { value_name: attribute.valueName } : {}),
    ...(attribute.values.length > 0
      ? {
          values: attribute.values.map(({ id, name }) => ({
            ...(id ? { id } : {}),
            ...(name ? { name } : {}),
          })),
        }
      : {}),
  };
}

function toMlSaleTerm(term: SimilarPublicationSaleTerm) {
  return {
    id: term.id,
    ...(term.valueId ? { value_id: term.valueId } : {}),
    ...(term.valueName ? { value_name: term.valueName } : {}),
  };
}

function safeError(error: unknown): {
  message: string;
  errorCode?: string;
  causes?: SimilarPublicationErrorCause[];
} {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    if (isJsonObject(response)) {
      const causes = safeCauses(response.cause);

      const message =
        text(response.mercadoLibreMessage) ??
        text(response.message) ??
        causes[0]?.message ??
        null;

      const errorCode =
        text(response.errorCode) ??
        text(response.mercadoLibreErrorCode) ??
        text(response.mercadoLibreError) ??
        text(response.error_code) ??
        text(response.error) ??
        causes[0]?.code ??
        null;

      return {
        message: message ?? 'Mercado Libre rechazó la nueva publicación',
        ...(errorCode ? { errorCode } : {}),
        ...(causes.length > 0 ? { causes } : {}),
      };
    }

    if (typeof response === 'string') {
      return { message: response.slice(0, 500) };
    }
  }

  return { message: 'No se pudo crear la publicación en Mercado Libre' };
}

function safeCauses(value: unknown): SimilarPublicationErrorCause[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values
    .filter(isJsonObject)
    .map((cause) => ({
      code:
        text(cause.code) ??
        text(cause.error_code),
      message:
        text(cause.message) ??
        text(cause.error_message),
      department: text(cause.department),
    }))
    .filter(
      ({ code, message, department }) =>
        Boolean(code || message || department),
    )
    .slice(0, 20);
}

function validItemId(value: unknown): value is string {
  return typeof value === 'string' && /^MLA\d+$/u.test(value);
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return text(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : null;
}
