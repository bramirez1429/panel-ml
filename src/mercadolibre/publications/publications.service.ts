import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { PublicationManagementReaderService } from './mutations/publication-management-reader.service';
import { PublicationLiveContentService } from './mutations/publication-live-content.service';

@Injectable()
export class PublicationsService {
  /** Recibe la conexión y los repositories de lectura. */
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly productsRepository: MercadolibreProductsRepository,
    private readonly childrenRepository: MercadolibreChildrenRepository,
    private readonly managementReader: PublicationManagementReaderService,
    private readonly liveContent: PublicationLiveContentService,
  ) {}

  /** Lista resúmenes paginados desde Supabase. */
  async list(page = 1, limit = 20) {
    this.validatePaging(page, limit);
    const connection = await this.tokenService.getStoredConnection();
    const result = await this.productsRepository.findPage(
      connection.seller_id,
      page,
      limit,
    );

    const variantProductIds = result.products
      .filter(({ model }) => model === 'VARIANT_PRICING')
      .map(({ id }) => id);
    const childAttributes = variantProductIds.length
      ? await this.childrenRepository.findAttributesByProductIds(
          variantProductIds,
        )
      : [];
    const variantSizes = groupSizesByProduct(childAttributes);
    const publications = result.products.map((product) => {
      const { shared_variations: storedVariations, ...summary } = product;
      const sharedVariations = asArray(storedVariations);
      const sizes =
        product.model === 'SHARED'
          ? sizesFromSharedVariations(sharedVariations)
          : (variantSizes.get(product.id) ?? []);

      return {
        ...summary,
        sizes,
        variants_count:
          product.model === 'SHARED'
            ? sharedVariations.length
            : product.children_count,
      };
    });

    return {
      paging: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
      count: publications.length,
      publications,
    };
  }

  /** Devuelve un producto guardado y sus hijos cuando corresponde. */
  async findOne(productId: string) {
    this.validateProductId(productId);
    const connection = await this.tokenService.getStoredConnection();
    const product = await this.productsRepository.findById(
      connection.seller_id,
      productId,
    );

    if (!product) {
      throw new NotFoundException('Publicación no encontrada');
    }
    if (product.model === 'SHARED') {
      const management = await this.managementReader.hydrate(
        product,
        product.parent_item_id ? [product.parent_item_id] : [],
      );
      const refreshedProduct =
        (await this.productsRepository.findById(
          connection.seller_id,
          productId,
        )) ?? product;
      const content = await this.liveContent.read(
        product.id,
        product.parent_item_id ? [product.parent_item_id] : [],
      );
      return {
        product: { ...refreshedProduct, ...(content ?? {}) },
        management,
      };
    }

    const children = await this.childrenRepository.findByProductId(product.id);
    const management = await this.managementReader.hydrate(
      product,
      children.map(({ item_id }) => item_id),
    );
    const refreshedProduct =
      (await this.productsRepository.findById(
        connection.seller_id,
        productId,
      )) ?? product;
    const refreshedChildren = await this.childrenRepository.findByProductId(
      product.id,
    );
    const content = await this.liveContent.read(
      product.id,
      refreshedChildren.map(({ item_id }) => item_id),
    );
    return {
      product: { ...refreshedProduct, ...(content ?? {}) },
      children: refreshedChildren,
      management,
    };
  }

  /** Valida la paginación solicitada. */
  private validatePaging(page: number, limit: number): void {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor que cero');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
  }

  /** Valida la PK UUID interna del producto. */
  private validateProductId(productId: string): void {
    if (!UUID_PATTERN.test(productId)) {
      throw new BadRequestException('productId debe ser un UUID válido');
    }
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AttributesByProduct = Readonly<{
  product_id: string;
  attributes: unknown;
}>;

/** Agrupa talles únicos de hijos sin consultar Mercado Libre. */
function groupSizesByProduct(
  children: readonly AttributesByProduct[],
): Map<string, string[]> {
  const grouped = new Map<string, Set<string>>();

  for (const child of children) {
    const size = preferredSize(child.attributes);
    if (!size) continue;
    const sizes = grouped.get(child.product_id) ?? new Set<string>();
    sizes.add(size);
    grouped.set(child.product_id, sizes);
  }

  return new Map(
    [...grouped].map(([productId, sizes]) => [
      productId,
      sortSizes([...sizes]),
    ]),
  );
}

/** Extrae talles de variaciones SHARED ya persistidas. */
function sizesFromSharedVariations(variations: readonly unknown[]): string[] {
  const sizes = new Set<string>();

  for (const variation of variations) {
    if (!isObject(variation)) continue;
    const size = preferredSize(variation.attributes);
    if (size) sizes.add(size);
  }

  return sortSizes([...sizes]);
}

/** Prioriza SIZE numérico y conserva fallbacks reales si no existe. */
function preferredSize(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const attributes = value.flatMap((attribute) => {
    if (!isObject(attribute)) return [];
    const id = text(attribute.id)?.toUpperCase();
    const valueName = text(attribute.valueName) ?? text(attribute.value_name);
    return id && valueName ? [{ id, valueName }] : [];
  });

  return (
    attributes.find(
      ({ id, valueName }) => id === 'SIZE' && isNumericSize(valueName),
    )?.valueName ??
    attributes.find(({ id }) => id === 'SIZE')?.valueName ??
    attributes.find(({ id }) => id === 'TALLE')?.valueName ??
    attributes.find(({ id }) => id === 'FILTRABLE_SIZE')?.valueName ??
    null
  );
}

function sortSizes(values: string[]): string[] {
  return values.sort((left, right) =>
    left.localeCompare(right, 'es', { numeric: true }),
  );
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isNumericSize(value: string): boolean {
  return /^\d+(?:[.,]\d+)?$/.test(value);
}
