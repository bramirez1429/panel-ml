import type {
  TiendanubeCreateProductDto,
  TiendanubeCreateProductVariantDto,
} from './tiendanube-replication.types';

export function withoutVariantImageSources(
  product: TiendanubeCreateProductDto,
): TiendanubeCreateProductDto {
  return {
    ...product,
    variants: product.variants.map(withoutVariantImageSource),
  };
}

function withoutVariantImageSource(
  variant: TiendanubeCreateProductVariantDto,
): TiendanubeCreateProductVariantDto {
  const { imageSrc, ...payload } = variant;
  void imageSrc;
  return payload;
}
