import { BadGatewayException, Injectable } from '@nestjs/common';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import type { TiendanubeConnectionCredentials } from '../connections/tiendanube-connection.repository';
import type {
  TiendanubeCreateProductDto,
  TiendanubeUpdateProductDto,
} from './tiendanube-replication.types';

type Identified = Readonly<{ id?: unknown }>;

@Injectable()
export class TiendanubeExistingProductSyncService {
  constructor(private readonly api: TiendanubeApiService) {}

  async sync(
    connection: TiendanubeConnectionCredentials,
    productId: string,
    source: TiendanubeCreateProductDto,
  ): Promise<void> {
    await this.syncBaseProduct(connection, productId, source);
    const imageIds = await this.syncImages(connection, productId, source);
    await this.syncVariants(connection, productId, source, imageIds);
  }

  private async syncBaseProduct(
    connection: TiendanubeConnectionCredentials,
    productId: string,
    source: TiendanubeCreateProductDto,
  ): Promise<void> {
    const update: TiendanubeUpdateProductDto = {
      name: source.name,
      ...(source.description ? { description: source.description } : {}),
      visibility: source.visibility,
      attributes: source.attributes,
      ...(source.brand ? { brand: source.brand } : {}),
      ...(source.categories?.length ? { categories: source.categories } : {}),
      ...(source.tags ? { tags: source.tags } : {}),
      ...(source.seo_title ? { seo_title: source.seo_title } : {}),
      ...(source.seo_description
        ? { seo_description: source.seo_description }
        : {}),
    };
    await this.api.put(
      connection.storeId,
      `/products/${encodeURIComponent(productId)}`,
      update,
      connection.accessToken,
    );
  }

  private async syncVariants(
    connection: TiendanubeConnectionCredentials,
    productId: string,
    source: TiendanubeCreateProductDto,
    imageIds: readonly string[],
  ): Promise<void> {
    const path = `/products/${encodeURIComponent(productId)}/variants`;
    if (source.attributes.length > 0 || source.variants.length !== 1) {
      const withImages = source.variants.map((variant, index) => ({
        ...variant,
        ...(imageIds[index % imageIds.length]
          ? { image_id: Number(imageIds[index % imageIds.length]) }
          : {}),
      }));
      await this.api.put(
        connection.storeId,
        path,
        withImages,
        connection.accessToken,
      );
      return;
    }
    const existing = await this.api.get<unknown[]>(
      connection.storeId,
      path,
      connection.accessToken,
    );
    const variantId = parseId(
      Array.isArray(existing) && existing.length === 1
        ? existing[0]
        : undefined,
    );
    await this.api.put(
      connection.storeId,
      `${path}/${encodeURIComponent(variantId)}`,
      {
        ...source.variants[0],
        ...(imageIds[0] ? { image_id: Number(imageIds[0]) } : {}),
      },
      connection.accessToken,
    );
  }

  private async syncImages(
    connection: TiendanubeConnectionCredentials,
    productId: string,
    source: TiendanubeCreateProductDto,
  ): Promise<readonly string[]> {
    const path = `/products/${encodeURIComponent(productId)}/images`;
    const existing = await this.api.get<unknown[]>(
      connection.storeId,
      path,
      connection.accessToken,
    );
    if (!Array.isArray(existing))
      throw new BadGatewayException('Tiendanube devolvió imágenes inválidas');
    for (const image of existing) {
      await this.api.delete(
        connection.storeId,
        `${path}/${encodeURIComponent(parseId(image))}`,
        connection.accessToken,
      );
    }
    const createdIds: string[] = [];
    for (const image of source.images) {
      const created = await this.api.post<unknown>(
        connection.storeId,
        path,
        image,
        connection.accessToken,
      );
      if (created !== undefined) {
        try {
          createdIds.push(parseId(created));
        } catch {
          // Algunas respuestas de mocks/implementaciones no incluyen el id;
          // la imagen igualmente fue enviada y no se asocia de forma inventada.
        }
      }
    }
    return createdIds;
  }
}

function parseId(value: unknown): string {
  const id =
    value && typeof value === 'object' && 'id' in value
      ? (value as Identified).id
      : undefined;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
    return String(id);
  if (typeof id === 'string' && /^[1-9]\d*$/u.test(id)) return id;
  throw new BadGatewayException(
    'Tiendanube devolvió un identificador inválido',
  );
}
