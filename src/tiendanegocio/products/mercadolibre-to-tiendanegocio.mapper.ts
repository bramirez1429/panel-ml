import { BadRequestException } from '@nestjs/common';
import type {
  ReplicableProduct,
  ReplicableProductVariant,
} from '../../tiendanube/replication/tiendanube-replication.types';

type Option = Readonly<{ id: string; title: string; position: number }>;
type Property = Readonly<{ title: string; new: true; values: readonly Option[] }>;
type VariantProperty = Readonly<{ id: string; title: string }>;

export type TiendaNegocioProductPayload = Readonly<{
  name: { es: string };
  description?: { es: string };
  published: false;
  requires_shipping: true;
  stock_management: true;
  brand?: string;
  properties?: readonly Property[];
  variants?: readonly Readonly<{
    price: string;
    stock: number;
    stock_management: true;
    published: false;
    sku?: string;
    properties: readonly VariantProperty[];
    weight?: number;
    width?: number;
    height?: number;
    depth?: number;
  }>[];
  price?: string;
  stock?: number;
  sku?: string;
}>;

/** Mapea exclusivamente campos documentados; las imágenes se cargan por separado. */
export class MercadoLibreToTiendaNegocioMapper {
  static map(source: ReplicableProduct): TiendaNegocioProductPayload {
    if (!source.title.trim() || source.variants.length === 0) {
      throw new BadRequestException('Producto de Mercado Libre sin nombre o variantes');
    }
    if (source.attributes.length > 3) {
      throw new BadRequestException('Hay demasiados atributos para validar');
    }
    const properties = buildProperties(source);
    const base = {
      name: { es: source.title.trim() },
      ...(source.description ? { description: { es: source.description } } : {}),
      ...(source.brand ? { brand: source.brand } : {}),
      published: false as const,
      requires_shipping: true as const,
      stock_management: true as const,
    };

    if (!source.attributes.length) {
      if (source.variants.length !== 1) {
        throw new BadRequestException('Hay varias variantes sin atributos');
      }
      const single = source.variants[0];
      validateVariant(single);
      return {
        ...base,
        price: String(single.price),
        stock: single.stock,
        ...(single.sku ? { sku: single.sku } : {}),
      };
    }

    return {
      ...base,
      properties,
      variants: source.variants.map((variant) =>
        toVariant(variant, source.attributes, properties)),
    };
  }
}

function buildProperties(source: ReplicableProduct): readonly Property[] {
  return source.attributes.map((attribute, index) => {
    const values = [...new Set(source.variants.flatMap((variant) =>
      variant.values
        .filter((value) => value.attributeId === attribute.id)
        .map((value) => value.value.trim()),
    ))];
    if (!values.length || values.some((value) => !value)) {
      throw new BadRequestException('Atributo sin valores');
    }
    return {
      title: attribute.name,
      new: true,
      values: values.map((title, position) => ({
        id: `A${index + 1}-V${position + 1}`,
        title,
        position,
      })),
    };
  });
}

function toVariant(
  variant: ReplicableProductVariant,
  attributes: ReplicableProduct['attributes'],
  properties: readonly Property[],
) {
  validateVariant(variant);
  const values = attributes.map((attribute, index) => {
    const found = variant.values.find((item) => item.attributeId === attribute.id);
    const property = properties[index].values.find((item) => item.title === found?.value.trim());
    if (!found || !property) {
      throw new BadRequestException('Variante con atributos incompatibles');
    }
    return { id: property.id, title: property.title };
  });
  return {
    price: String(variant.price),
    stock: variant.stock,
    stock_management: true as const,
    published: false as const,
    properties: values,
    ...(variant.sku ? { sku: variant.sku } : {}),
    ...dimensions(variant),
  };
}

function validateVariant(value: ReplicableProductVariant): void {
  if (!Number.isFinite(value.price) || value.price <= 0 ||
    !Number.isSafeInteger(value.stock) || value.stock < 0) {
    throw new BadRequestException('Precio o stock inválido de Mercado Libre');
  }
}

function dimensions(value: ReplicableProductVariant) {
  const result: Record<string, number> = {};
  for (const field of ['weight', 'width', 'height', 'depth'] as const) {
    const number = value[field];
    if (number === undefined || number === null) continue;
    if (!Number.isFinite(number) || number < 0) {
      throw new BadRequestException('Dimensión inválida de la variante');
    }
    result[field] = number;
  }
  return result;
}
