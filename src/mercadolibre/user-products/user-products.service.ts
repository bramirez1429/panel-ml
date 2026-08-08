import { BadGatewayException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import {
  MercadoLibreUserProduct,
  UserProductMetadata,
  UserProductReferenceSource,
} from './user-product.types';

const MAX_CONCURRENT_REQUESTS = 4;

@Injectable()
export class UserProductsService {
  /** Prepara el acceso compartido a Mercado Libre. */
  constructor(private readonly apiService: MercadolibreApiService) {}

  /** Consulta un User Product y valida su identificador. */
  async getUserProduct(
    userProductId: string,
    accessToken: string,
  ): Promise<MercadoLibreUserProduct> {
    const id = normalizeUserProductId(userProductId);
    if (!id) {
      throw new BadGatewayException('User Product inválido');
    }

    const data = await this.apiService.get<unknown>(
      `/user-products/${encodeURIComponent(id)}`,
      accessToken,
    );
    if (!isObject(data) || data.id !== id) {
      throw new BadGatewayException('Respuesta de User Product inválida');
    }

    return { ...data, id };
  }

  /** Devuelve la metadata necesaria para agrupar un User Product. */
  async getUserProductMetadata(
    userProductId: string,
    accessToken: string,
  ): Promise<UserProductMetadata> {
    const userProduct = await this.getUserProduct(userProductId, accessToken);
    const familyId = identifierOrNull(userProduct.family_id);
    if (!familyId) {
      throw new BadGatewayException('User Product sin family_id válido');
    }

    return {
      id: userProduct.id,
      familyId,
      name: textOrNull(userProduct.name),
    };
  }

  /** Obtiene el family_id de un User Product. */
  async getFamilyId(
    userProductId: string,
    accessToken: string,
  ): Promise<string> {
    const metadata = await this.getUserProductMetadata(
      userProductId,
      accessToken,
    );
    return metadata.familyId;
  }

  /** Consulta metadata única con hasta cuatro solicitudes simultáneas. */
  async getMetadataMap(
    userProductIds: string[],
    accessToken: string,
  ): Promise<Map<string, UserProductMetadata>> {
    const ids = uniqueUserProductIds(userProductIds);
    const metadata = new Map<string, UserProductMetadata>();

    for (let index = 0; index < ids.length; index += MAX_CONCURRENT_REQUESTS) {
      const currentIds = ids.slice(index, index + MAX_CONCURRENT_REQUESTS);
      const results = await Promise.all(
        currentIds.map((id) => this.getUserProductMetadata(id, accessToken)),
      );
      for (const result of results) metadata.set(result.id, result);
    }

    return metadata;
  }

  /** Lee el MLAU ubicado en la raíz de un MLA. */
  getRootUserProductId(source: UserProductReferenceSource): string | null {
    return normalizeUserProductId(source.user_product_id);
  }

  /** Lee los MLAU informados dentro de variations. */
  getVariationUserProductIds(source: UserProductReferenceSource): string[] {
    if (!Array.isArray(source.variations)) return [];

    const ids = source.variations.flatMap((variation) => {
      if (!isObject(variation)) return [];
      const id = normalizeUserProductId(variation.user_product_id);
      return id ? [id] : [];
    });
    return [...new Set(ids)];
  }

  /** Reúne los MLAU de raíz y variaciones sin duplicados. */
  getPublicationUserProductIds(source: UserProductReferenceSource): string[] {
    const rootId = this.getRootUserProductId(source);
    return [
      ...new Set([
        ...(rootId ? [rootId] : []),
        ...this.getVariationUserProductIds(source),
      ]),
    ];
  }
}

/** Comprueba que el valor sea un objeto JSON. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normaliza un identificador MLAU. */
function normalizeUserProductId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.startsWith('MLAU') && id.length > 4 ? id : null;
}

/** Convierte un identificador externo a texto. */
function identifierOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

/** Devuelve texto no vacío o null. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Elimina identificadores MLAU inválidos y repetidos. */
function uniqueUserProductIds(values: string[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const id = normalizeUserProductId(value);
        return id ? [id] : [];
      }),
    ),
  ];
}
