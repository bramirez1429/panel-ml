import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { isIdentifierAttribute } from './similar-publication.mapper';
import type {
  SimilarPublicationAttribute,
  SimilarPublicationCreateInput,
  SimilarPublicationSaleTerm,
} from './similar-publication.types';

const WRITABLE_CHANNELS = new Set(['marketplace', 'mshops']);

@Injectable()
export class SimilarPublicationValidationService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  parse(value: unknown): SimilarPublicationCreateInput {
    if (!isJsonObject(value)) throw invalid('El borrador es obligatorio');
    const sourceKey = requiredText(value.sourceKey, 'sourceKey');
    const variants = Array.isArray(value.variants)
      ? value.variants.map((variant, index) => parseVariant(variant, index))
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
  ): Promise<void> {
    const [category, attributes] = await Promise.all([
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(input.categoryId)}`,
        accessToken,
      ),
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(input.categoryId)}/attributes`,
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
    const requiredIds = attributes.flatMap((attribute) => {
      if (!isJsonObject(attribute) || !isJsonObject(attribute.tags)) return [];
      const id = optionalText(attribute.id);
      return id && attribute.tags.required === true ? [id] : [];
    });
    for (const variant of input.variants) {
      const present = new Set(
        variant.attributes.filter(hasAttributeValue).map(({ id }) => id),
      );
      const missing = requiredIds.filter((id) => !present.has(id));
      if (missing.length > 0) {
        throw invalid(
          `Faltan atributos obligatorios para ${variant.sourceReference}: ${missing.join(', ')}`,
        );
      }
    }
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

function parseVariant(value: unknown, index: number) {
  if (!isJsonObject(value))
    throw invalid(`La variante ${index + 1} es inválida`);
  const attributes = Array.isArray(value.attributes)
    ? value.attributes.map((attribute) => parseAttribute(attribute))
    : [];
  return {
    sourceReference: requiredText(value.sourceReference, 'sourceReference'),
    price: requiredNumber(value.price, 'price'),
    stock: requiredInteger(value.stock, 'stock'),
    sku: optionalText(value.sku),
    attributes,
    pictureIds: parseStrings(value.pictureIds, 'pictureIds'),
  };
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
