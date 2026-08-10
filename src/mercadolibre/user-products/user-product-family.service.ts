import { BadGatewayException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
  isPositiveInteger,
} from '../shared/mercadolibre.types';
import {
  MercadoLibreUserProduct,
  ResolvedUserProductFamily,
  UserProductFamily,
  UserProductFamilyCache,
} from './user-product.types';
import { UserProductsService } from './user-products.service';

const SITE_ID = 'MLA';

@Injectable()
export class UserProductFamilyService {
  /** Prepara el acceso a User Products y familias. */
  constructor(
    private readonly apiService: MercadolibreApiService,
    private readonly userProductsService: UserProductsService,
  ) {}

  /** Crea caches aislados para una sola sincronización. */
  createCache(): UserProductFamilyCache {
    return {
      userProducts: new Map(),
      families: new Map(),
      familyByUserProduct: new Map(),
    };
  }

  /** Obtiene un User Product una sola vez durante la corrida. */
  getUserProduct(
    userProductId: string,
    accessToken: string,
    cache: UserProductFamilyCache,
  ): Promise<MercadoLibreUserProduct> {
    const id = normalizeUserProductId(userProductId);
    if (!id) throw new BadGatewayException('User Product inválido');
    const cached = cache.userProducts.get(id);
    if (cached) return cached;

    const request = this.userProductsService.getUserProduct(id, accessToken);
    cache.userProducts.set(id, request);
    return request;
  }

  /** Consulta una familia y cachea todos sus MLAU. */
  async getFamily(
    familyId: string,
    accessToken: string,
    cache: UserProductFamilyCache,
  ): Promise<UserProductFamily> {
    const id = normalizeFamilyId(familyId);
    if (!id) throw new BadGatewayException('family_id inválido');

    const cached = cache.families.get(id);
    if (cached) return cached;

    const request = this.fetchFamily(id, accessToken);
    cache.families.set(id, request);
    const family = await request;
    for (const userProductId of family.userProductIds) {
      cache.familyByUserProduct.set(userProductId, request);
    }
    return family;
  }

  /** Resuelve la familia y el nombre de un MLAU. */
  async resolveFamily(
    userProductId: string,
    accessToken: string,
    cache: UserProductFamilyCache,
  ): Promise<ResolvedUserProductFamily> {
    const id = normalizeUserProductId(userProductId);
    if (!id) throw new BadGatewayException('User Product inválido');
    const userProductPromise = this.getUserProduct(id, accessToken, cache);
    const knownFamily = cache.familyByUserProduct.get(id);
    const userProduct = await userProductPromise;
    const family = knownFamily
      ? await knownFamily
      : await this.getFamily(
          requireFamilyId(userProduct.family_id),
          accessToken,
          cache,
        );

    if (!family.userProductIds.includes(userProduct.id)) {
      throw new BadGatewayException(
        'El User Product no pertenece a la familia informada',
      );
    }
    return {
      userProductId: userProduct.id,
      userProductName: textOrNull(userProduct.name),
      familyId: family.familyId,
      userId: family.userId,
      userProductIds: family.userProductIds,
    };
  }

  /** Consulta y valida una familia del sitio MLA. */
  private async fetchFamily(
    familyId: string,
    accessToken: string,
  ): Promise<UserProductFamily> {
    const data = await this.apiService.get<unknown>(
      `/sites/${SITE_ID}/user-products-families/${encodeURIComponent(familyId)}`,
      accessToken,
    );
    if (!isJsonObject(data)) throw invalidFamilyResponse();

    const responseFamilyId = normalizeFamilyId(data.family_id);
    if (responseFamilyId !== familyId || data.site_id !== SITE_ID) {
      throw invalidFamilyResponse();
    }
    if (!isPositiveInteger(data.user_id)) throw invalidFamilyResponse();
    const userProductIds = parseUserProductIds(data.user_products_ids);

    return {
      familyId,
      siteId: SITE_ID,
      userId: data.user_id,
      userProductIds,
    };
  }
}

/** Valida los MLAU informados por una familia. */
function parseUserProductIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidFamilyResponse();
  }
  const values: unknown[] = value;
  if (values.some((id) => !normalizeUserProductId(id))) {
    throw invalidFamilyResponse();
  }
  return [...new Set(values.flatMap((id) => normalizeUserProductId(id) ?? []))];
}

/** Normaliza un MLAU. */
function normalizeUserProductId(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const id = value.trim();
  return /^MLAU\d+$/.test(id) ? id : null;
}

/** Normaliza un family_id numérico. */
function normalizeFamilyId(value: unknown): string | null {
  if (isNonEmptyString(value) && /^\d+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  return null;
}

/** Exige un family_id válido. */
function requireFamilyId(value: unknown): string {
  const familyId = normalizeFamilyId(value);
  if (!familyId) {
    throw new BadGatewayException('User Product sin family_id válido');
  }
  return familyId;
}

/** Devuelve un texto externo o null. */
function textOrNull(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}

/** Crea el error común para una familia mal formada. */
function invalidFamilyResponse(): BadGatewayException {
  return new BadGatewayException('Respuesta de familia inválida');
}
