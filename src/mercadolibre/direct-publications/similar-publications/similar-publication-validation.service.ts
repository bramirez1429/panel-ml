import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { isIdentifierAttribute } from './similar-publication.mapper';
import type {
  SimilarPublicationAttribute,
  SimilarPublicationCreateInput,
  SimilarPublicationCreationCategoryRules,
  SimilarPublicationPackage,
  SimilarPublicationPackageAttributeIds,
  SimilarPublicationSaleTerm,
} from './similar-publication.types';

const WRITABLE_CHANNELS = new Set(['marketplace', 'mshops']);

@Injectable()
export class SimilarPublicationValidationService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  parse(value: unknown): SimilarPublicationCreateInput {
    if (!isJsonObject(value)) throw invalid('El borrador es obligatorio');
    const sourceKey = requiredText(value.sourceKey, 'sourceKey');
    const commonAttributes = mergeAttributes(
      parseAttributes(value.commonAttributes),
      parseAttributes(value.mainAttributes),
    );
    const variants = Array.isArray(value.variants)
      ? value.variants.map((variant, index) =>
          parseVariant(variant, index, commonAttributes),
        )
      : [];
    if (variants.length === 0)
      throw invalid('Debe existir al menos una variante');
    const references = variants.map(({ sourceReference }) => sourceReference);
    if (new Set(references).size !== references.length) {
      throw invalid('sourceReference debe ser único por variante');
    }
    const channels = parseStrings(value.channels, 'channels');
    if (channels.some((channel) => !WRITABLE_CHANNELS.has(channel))) {
      throw invalid(
        'Hay un canal que no puede usarse para crear publicaciones',
      );
    }
    return {
      sourceKey,
      categoryId: requiredText(value.categoryId, 'categoryId'),
      familyName: optionalText(value.familyName),
      titleTemplate: optionalText(value.titleTemplate),
      description: optionalText(value.description),
      currencyId: requiredText(value.currencyId, 'currencyId'),
      listingTypeId: requiredText(value.listingTypeId, 'listingTypeId'),
      buyingMode: requiredText(value.buyingMode, 'buyingMode'),
      condition: parseCondition(value.condition),
      package: parsePackage(value.package),
      saleTerms: parseSaleTerms(value.saleTerms),
      shipping: parseShipping(value.shipping),
      channels,
      variants,
      pictures: parseStrings(value.pictures, 'pictures'),
    };
  }

  async validateCategory(
    input: SimilarPublicationCreateInput,
    accessToken: string,
  ): Promise<SimilarPublicationCreationCategoryRules> {
    const [category, attributes, saleTerms] = await Promise.all([
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(input.categoryId)}`,
        accessToken,
      ),
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(input.categoryId)}/attributes`,
        accessToken,
      ),
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(input.categoryId)}/sale_terms`,
        accessToken,
      ),
    ]);
    if (!isJsonObject(category) || category.id !== input.categoryId) {
      throw invalid('Mercado Libre devolvió una categoría inválida');
    }
    const settings = isJsonObject(category.settings) ? category.settings : null;
    if (settings?.listing_allowed === false) {
      throw invalid('La categoría elegida no permite crear publicaciones');
    }
    if (!Array.isArray(attributes)) {
      throw invalid('Mercado Libre devolvió atributos de categoría inválidos');
    }
    const writableAttributeIds =
      writableAttributeIdsOf(attributes);

    const allowedSaleTermIds =
      saleTermIdsOf(saleTerms);

    const requiredIds = attributes.flatMap((attribute) => {
      if (!isJsonObject(attribute) || !isJsonObject(attribute.tags)) return [];
      const id = optionalText(attribute.id);
      return id &&
        (
          attribute.tags.required === true ||
          attribute.tags.new_required === true
        )
        ? [id]
        : [];
    });
    const packageAttributeIds = packageAttributeIdsOf(attributes);
    validateCondition(input, category);
    const suppliedPackageIds = packageIdsWithValues(
      input.package,
      packageAttributeIds,
    );
    for (const variant of input.variants) {
      const present = new Set(
        variant.attributes.filter(hasAttributeValue).map(({ id }) => id),
      );
      const missing = requiredIds.filter(
        (id) =>
          !present.has(id) &&
          !suppliedPackageIds.has(id) &&
          !(id === 'ITEM_CONDITION' && input.condition !== null),
      );
      if (missing.length > 0) {
        throw invalid(
          `Faltan atributos obligatorios para ${variant.sourceReference}: ${missing.join(', ')}`,
        );
      }
    }
    return {
      packageAttributeIds,
      writableAttributeIds,
      allowedSaleTermIds,
    };
  }

  validateNewData(
    input: SimilarPublicationCreateInput,
    originalIdentifierValues: ReadonlySet<string>,
    originalPictureIds: ReadonlySet<string>,
  ): void {
    for (const variant of input.variants) {
      if (!(variant.price > 0)) throw invalid('El precio debe ser mayor a 0');
      if (!Number.isSafeInteger(variant.stock) || variant.stock < 0) {
        throw invalid('El stock debe ser un entero mayor o igual a 0');
      }
      if (variant.pictureIds.length === 0) {
        throw invalid(
          `Asigná al menos una imagen nueva a ${variant.sourceReference}`,
        );
      }
      if (variant.pictureIds.some((id) => originalPictureIds.has(id))) {
        throw invalid(
          'No se pueden reutilizar imágenes de la publicación original',
        );
      }
      const submittedIdentifiers = [
        variant.sku,
        ...variant.attributes.flatMap((attribute) =>
          isIdentifierAttribute(attribute.id)
            ? [
                attribute.valueId,
                attribute.valueName,
                ...attribute.values.flatMap(({ id, name }) => [id, name]),
              ]
            : [],
        ),
      ].flatMap((candidate) => optionalText(candidate) ?? []);
      if (
        submittedIdentifiers.some((candidate) =>
          originalIdentifierValues.has(candidate.toLocaleLowerCase()),
        )
      ) {
        throw invalid('El SKU o identificador de producto debe ser nuevo');
      }
    }
  }
}

function parseCondition(
  value: unknown,
): SimilarPublicationCreateInput['condition'] {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value)) throw invalid('condition inválida');
  return {
    id: requiredText(value.id, 'condition.id'),
    name: optionalText(value.name),
  };
}

function parsePackage(value: unknown): SimilarPublicationPackage | undefined {
  if (value === undefined) return undefined;
  if (value === null) return parsePackage({});
  if (!isJsonObject(value)) throw invalid('package inválido');
  return {
    hasFactoryPackaging: nullableBoolean(
      value.hasFactoryPackaging,
      'package.hasFactoryPackaging',
    ),
    widthCm: positiveNullableNumber(value.widthCm, 'package.widthCm'),
    heightCm: positiveNullableNumber(value.heightCm, 'package.heightCm'),
    lengthCm: positiveNullableNumber(value.lengthCm, 'package.lengthCm'),
    weightKg: positiveNullableNumber(value.weightKg, 'package.weightKg'),
  };
}

function writableAttributeIdsOf(
  attributes: unknown[],
): string[] {
  return attributes.flatMap((attribute) => {
    if (!isJsonObject(attribute)) return [];

    const id = optionalText(attribute.id);
    if (!id) return [];

    const tags = isJsonObject(attribute.tags)
      ? attribute.tags
      : {};

    return tags.read_only !== true &&
      tags.inferred !== true &&
      tags.fixed !== true
      ? [id]
      : [];
  });
}

function saleTermIdsOf(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : isJsonObject(value) && Array.isArray(value.sale_terms)
      ? value.sale_terms
      : [];

  return entries.flatMap((entry) => {
    if (!isJsonObject(entry)) return [];

    const id = optionalText(entry.id);
    if (!id) return [];

    const tags = isJsonObject(entry.tags)
      ? entry.tags
      : {};

    /*
     * El endpoint /sale_terms también puede devolver
     * términos administrados por Mercado Libre.
     * Que aparezcan en el recurso no significa que el
     * seller pueda enviarlos en POST /items.
     */
    if (
      tags.read_only === true ||
      tags.inferred === true ||
      tags.fixed === true
    ) {
      return [];
    }

    return [id];
  });
}

function packageAttributeIdsOf(
  attributes: unknown[],
): SimilarPublicationPackageAttributeIds {
  const writableIds =
    writableAttributeIdsOf(attributes);
  const first = (candidates: string[]): string | null =>
    candidates.find((id) => writableIds.includes(id)) ?? null;
  return {
    hasFactoryPackaging:
      writableIds.find((id) => /(?:FACTORY|ORIGINAL)_PACKAG/iu.test(id)) ??
      null,
    width: first(['SELLER_PACKAGE_WIDTH', 'PACKAGE_WIDTH']),
    height: first(['SELLER_PACKAGE_HEIGHT', 'PACKAGE_HEIGHT']),
    length: first(['SELLER_PACKAGE_LENGTH', 'PACKAGE_LENGTH']),
    weight: first(['SELLER_PACKAGE_WEIGHT', 'PACKAGE_WEIGHT']),
  };
}

function packageIdsWithValues(
  value: SimilarPublicationPackage | undefined,
  ids: SimilarPublicationPackageAttributeIds,
): Set<string> {
  const result = new Set<string>();
  if (!value) return result;
  if (value.hasFactoryPackaging !== null && ids.hasFactoryPackaging) {
    result.add(ids.hasFactoryPackaging);
  }
  if (value.widthCm !== null && ids.width) result.add(ids.width);
  if (value.heightCm !== null && ids.height) result.add(ids.height);
  if (value.lengthCm !== null && ids.length) result.add(ids.length);
  if (value.weightKg !== null && ids.weight) result.add(ids.weight);
  return result;
}

function validateCondition(
  input: SimilarPublicationCreateInput,
  category: Record<string, unknown>,
): void {
  if (!input.condition) return;
  const settings = isJsonObject(category.settings) ? category.settings : null;
  if (!Array.isArray(settings?.item_conditions)) return;
  const allowed = settings.item_conditions.flatMap(
    (value: unknown) => optionalText(value) ?? [],
  );
  if (allowed.length > 0 && !allowed.includes(input.condition.id)) {
    throw invalid('La condición no está permitida para la categoría');
  }
}

function nullableBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw invalid(`${field} debe ser booleano`);
  return value;
}

function positiveNullableNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${field} debe ser mayor a 0`);
  }
  return value;
}

function parseVariant(
  value: unknown,
  index: number,
  commonAttributes: SimilarPublicationAttribute[],
) {
  if (!isJsonObject(value))
    throw invalid(`La variante ${index + 1} es inválida`);
  const attributes = mergeAttributes(
    parseAttributes(value.attributes),
    commonAttributes,
    parseAttributes(value.variantAttributes),
  );
  return {
    sourceReference: requiredText(value.sourceReference, 'sourceReference'),
    price: requiredNumber(value.price, 'price'),
    stock: requiredInteger(value.stock, 'stock'),
    sku: optionalText(value.sku),
    attributes,
    pictureIds: parseStrings(value.pictureIds, 'pictureIds'),
  };
}

function parseAttributes(value: unknown): SimilarPublicationAttribute[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('attributes debe ser un array');
  return value.map((attribute) => parseAttribute(attribute));
}

function mergeAttributes(
  ...groups: SimilarPublicationAttribute[][]
): SimilarPublicationAttribute[] {
  const result = new Map<string, SimilarPublicationAttribute>();
  for (const attribute of groups.flat()) result.set(attribute.id, attribute);
  return [...result.values()];
}

function parseAttribute(value: unknown): SimilarPublicationAttribute {
  if (!isJsonObject(value)) throw invalid('Atributo inválido');
  return {
    id: requiredText(value.id, 'attribute.id'),
    name: optionalText(value.name),
    valueId: optionalText(value.valueId),
    valueName: optionalText(value.valueName),
    values: Array.isArray(value.values)
      ? value.values.map((entry) => {
          if (!isJsonObject(entry)) throw invalid('Valor de atributo inválido');
          return { id: optionalText(entry.id), name: optionalText(entry.name) };
        })
      : [],
  };
}

function parseSaleTerms(value: unknown): SimilarPublicationSaleTerm[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('saleTerms debe ser un array');
  return value.map((entry) => {
    if (!isJsonObject(entry)) throw invalid('Término de venta inválido');
    return {
      id: requiredText(entry.id, 'saleTerm.id'),
      valueId: optionalText(entry.valueId),
      valueName: optionalText(entry.valueName),
    };
  });
}

function parseShipping(value: unknown): { freeShipping: boolean } | null {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value) || typeof value.freeShipping !== 'boolean') {
    throw invalid('shipping inválido');
  }
  return { freeShipping: value.freeShipping };
}

function parseStrings(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} debe ser un array`);
  const result = value.map((entry) => requiredText(entry, field));
  return [...new Set(result)];
}

function requiredText(value: unknown, field: string): string {
  const result = optionalText(value);
  if (!result) throw invalid(`${field} es obligatorio`);
  return result;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(`${field} debe ser numérico`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw invalid(`${field} debe ser entero`);
  }
  return value;
}

function hasAttributeValue(attribute: SimilarPublicationAttribute): boolean {
  return Boolean(
    attribute.valueId ||
    attribute.valueName ||
    attribute.values.some(({ id, name }) => Boolean(id || name)),
  );
}

function invalid(message: string): BadRequestException {
  return new BadRequestException(message);
}
