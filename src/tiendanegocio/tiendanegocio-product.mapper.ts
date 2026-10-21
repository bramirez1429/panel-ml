import { BadRequestException } from '@nestjs/common';
import type { ReplicableProduct } from '../tiendanube/replication/tiendanube-replication.types';

/** Contract: https://docs.developers.tiendanegocio.com/docs/api/products */
export type TiendaNegocioCreateProduct = {
  name: { es: string };
  description?: { es: string };
  published: false;
  requires_shipping: true;
  brand: string;
  seo_title: string;
  seo_description?: string;
  stock_management: true;
  price?: string;
  stock?: number;
  sku?: string;
  properties?: Array<{
    title: string;
    new: true;
    values: Array<{ id: string; title: string; position: number }>;
  }>;
  variants?: Array<{
    price: string;
    stock: number;
    stock_management: true;
    published: false;
    sku?: string;
    properties: Array<{ id: string; title: string }>;
    weight?: number;
    width?: number;
    height?: number;
    depth?: number;
  }>;
};

export type TiendaNegocioProductPreview = {
  product: TiendaNegocioCreateProduct;
  imageUrls: string[];
  warnings: string[];
  readyForImport: boolean;
};

/**
 * Preview-only adapter. Marketplace categories cannot be reused as store category IDs.
 * Photos must be uploaded separately via the image API after product creation.
 * All new products and variants remain unpublished pending manual review.
 */
export function mapMercadoLibreToTiendaNegocio(source: ReplicableProduct): TiendaNegocioProductPreview {
  if (!source.title?.trim() || !source.variants?.length)
    throw new BadRequestException('Producto de Mercado Libre sin título o variantes');
  if (source.attributes.length > 3)
    throw new BadRequestException('Tienda Negocio: máximo tres atributos');

  const warnings: string[] = [];
  const skus = new Set<string>();
  const combinations = new Set<string>();
  const attributes = source.attributes.map((attribute, index) => {
    const values = [...new Set(source.variants.flatMap((variant) =>
      variant.values.filter((entry) => entry.attributeId === attribute.id)
        .map((entry) => entry.value.trim()).filter(Boolean),
    ))];
    return {
      sourceId: attribute.id,
      title: attribute.name.trim(),
      values: values.map((title, valueIndex) => ({
        id: `S${index + 1}V${valueIndex + 1}`,
        title,
        position: valueIndex,
      })),
    };
  });

  const mappedVariants = source.variants.map((variant) => {
    if (!Number.isFinite(variant.price) || variant.price <= 0 ||
      !Number.isSafeInteger(variant.stock) || variant.stock < 0)
      throw new BadRequestException('Precio o stock inválido');

    const sku = variant.sku?.trim() || undefined;
    if (!sku) warnings.push('Una variante no tiene SKU: hace falta para vincular inventarios');
    else if (skus.has(sku)) warnings.push(`SKU duplicado: ${sku}`);
    else skus.add(sku);

    const properties = attributes.map((attribute) => {
      const matching = variant.values.filter((entry) => entry.attributeId === attribute.sourceId);
      if (matching.length !== 1) throw new BadRequestException('Atributo faltante o repetido');
      const value = attribute.values.find((entry) => entry.title === matching[0].value.trim());
      if (!value) throw new BadRequestException('Valor de atributo no reconocido');
      return { id: value.id, title: value.title };
    });
    if (variant.values.length !== attributes.length)
      throw new BadRequestException('Cantidad de atributos inválida');

    const combination = JSON.stringify(properties.map(({ id }) => id));
    if (combinations.has(combination))
      throw new BadRequestException('Combinación de variantes duplicada');
    combinations.add(combination);
    return {
      price: variant.price.toFixed(2),
      stock: variant.stock,
      stock_management: true as const,
      published: false as const,
      ...(sku ? { sku } : {}),
      properties,
      ...(variant.weight != null ? { weight: variant.weight } : {}),
      ...(variant.width != null ? { width: variant.width } : {}),
      ...(variant.height != null ? { height: variant.height } : {}),
      ...(variant.depth != null ? { depth: variant.depth } : {}),
    };
  });

  const title = source.title.trim();
  const description = source.description?.trim() || null;
  const imageUrls = [...new Set(source.images.map((url) => url.trim()).filter(Boolean))];

  if (imageUrls.length) warnings.push('Las fotos se subirán en una etapa separada; no están en este payload');
  warnings.push('Revisar precios: Mercado Libre y Tienda Negocio pueden necesitar tarifas distintas');
  warnings.push('Asignar categorías de Tienda Negocio manualmente; no se copian IDs de Mercado Libre');

  const base = {
    name: { es: title },
    ...(description ? { description: { es: escapeHtml(description).replace(/\r\n?|\n/g, '<br>') } } : {}),
    published: false as const,
    requires_shipping: true as const,
    brand: 'SAEL',
    seo_title: (source.seoTitle?.trim() || title).slice(0, 70),
    ...(source.seoDescription || description ?
      { seo_description: (source.seoDescription?.trim() || description || '').slice(0, 320) } : {}),
    stock_management: true as const,
  };

  const product: TiendaNegocioCreateProduct = attributes.length
    ? {
        ...base,
        properties: attributes.map(({ title: attributeTitle, values }) => ({
          title: attributeTitle, new: true as const, values,
        })),
        variants: mappedVariants,
      }
    : {
        ...base,
        price: mappedVariants[0].price,
        stock: mappedVariants[0].stock,
        ...(mappedVariants[0].sku ? { sku: mappedVariants[0].sku } : {}),
      };
  if (!attributes.length && source.variants.length !== 1)
    throw new BadRequestException('Producto sin atributos tiene múltiples variantes');

  return {
    product,
    imageUrls,
    warnings: [...new Set(warnings)],
    readyForImport: !warnings.some((warning) => warning.includes('SKU')),
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
