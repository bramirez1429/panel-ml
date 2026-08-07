import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MercadoLibreConnection,
  SupabaseService,
} from '../database/supabase.service';
import type {
  CreatePriceDiscountDto,
  ReplaceDealDto,
  UpdatePricingDto,
} from './update-price.dto';

const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT = 10_000;
const MULTIGET_SIZE = 20;
const MAX_CONCURRENT = 4;
const INVALID_JSON = Symbol('invalid-json');
const ACTIVE_PROMOTION_STATUSES = new Set([
  'started',
  'active',
  'pending',
  'programmed',
]);

type JsonObject = Record<string, unknown>;
type RequiredConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';
type RequestKind =
  'tokenExchange' | 'scroll' | 'prices' | 'salePrice' | 'promotion';
type ItemError = { id: string; code: number; body: unknown };
type BatchResult = {
  publications: JsonObject[];
  errors: ItemError[];
};

type UserProductMetadata = {
  id: string;
  familyId: string | null;
  name: string | null;
  attributes: unknown[];
  pictures: unknown[];
};

type UserProductGroup = {
  id: string;
  name: string | null;
  attributes: unknown[];
  pictures: unknown[];
  publications: JsonObject[];
};

type FamilyPublicationGroup = {
  model: 'USER_PRODUCT';
  id: string;
  familyId: string | null;
  familyName: string | null;
  userProducts: UserProductGroup[];
};

type LegacyPublicationGroup = {
  model: 'LEGACY';
  id: string;
  itemId: string;
  title: string | null;
  variations: unknown[];
  publication: JsonObject;
};

type PublicationGroup = FamilyPublicationGroup | LegacyPublicationGroup;
type MultigetEntry = { code?: unknown; body?: unknown };
type MercadoLibreTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};

interface MercadoLibrePriceNode {
  type: string;
  amount: number;
  currency_id: string;
  conditions: { context_restrictions: string[] };
}

interface MercadoLibrePricesResponse {
  id: string;
  prices: MercadoLibrePriceNode[];
}

interface MercadoLibreSalePriceResponse {
  amount: number;
  regular_amount: number | null;
  currency_id: string;
}

export interface ItemPromotion {
  id?: string;
  type: string;
  status: string;
  price?: number;
  topPrice?: number;
  originalPrice?: number;
  minDiscountedPrice: number | null;
  maxDiscountedPrice: number | null;
  suggestedDiscountedPrice: number | null;
  subType: string | null;
  currency: string | null;
  startDate?: string;
  finishDate?: string;
  name?: string;
}

interface PriceDiscountRequest {
  deal_price: number;
  start_date: string;
  finish_date: string;
  promotion_type: 'PRICE_DISCOUNT';
}

interface DealUpdateRequest {
  deal_price: number;
  promotion_id: string;
  promotion_type: 'DEAL';
  top_deal_price?: number;
}

type SalePriceResult = {
  salePrice: number | null;
  promotionRegularPrice: number | null;
  currencyId?: string;
  priceError?: { status: number; message: string };
};

@Injectable()
export class MercadolibreService {
  private readonly supabaseService: SupabaseService;

  /** Prepara el acceso simple a Supabase. */
  constructor(private readonly configService: ConfigService) {
    this.supabaseService = new SupabaseService(configService);
  }

  /** Crea la URL para autorizar la cuenta en Mercado Libre. */
  createAuthorizationUrl(): string {
    const authorizationUrl = new URL(AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      redirect_uri: this.getRedirectUri(),
      state: this.createState(),
    }).toString();

    return authorizationUrl.toString();
  }

  /** Comprueba que el state sea auténtico y no haya vencido. */
  verifyState(state: string): boolean {
    if (typeof state !== 'string') {
      return false;
    }

    const parts = state.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const [nonce, timestampValue, receivedSignature] = parts;
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
      !/^\d{13}$/.test(timestampValue) ||
      !/^[A-Za-z0-9_-]{43}$/.test(receivedSignature)
    ) {
      return false;
    }

    const timestamp = Number(timestampValue);
    const age = Date.now() - timestamp;
    if (!Number.isSafeInteger(timestamp) || age < 0 || age > STATE_TTL_MS) {
      return false;
    }

    const payload = `${nonce}.${timestampValue}`;
    const expectedSignature = this.signState(payload);
    const receivedBuffer = Buffer.from(receivedSignature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');

    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  }

  /** Intercambia el código OAuth por tokens de Mercado Libre. */
  async exchangeCode(code: string): Promise<MercadoLibreTokens> {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      client_secret: this.getRequiredConfig('ML_CLIENT_SECRET'),
      code,
      redirect_uri: this.getRedirectUri(),
    });

    const response = await this.requestJson(
      `${API_URL}/oauth/token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
      'tokenExchange',
    );

    return this.parseTokens(response);
  }

  /** Obtiene los datos básicos de la cuenta autorizada. */
  async getCurrentUser(accessToken: string) {
    const data = await this.requestJson<unknown>(`${API_URL}/users/me`, {
      headers: this.auth(accessToken),
    });
    if (!isObject(data)) {
      throw new BadGatewayException('Datos de vendedor inválidos');
    }
    const { id, nickname } = data;

    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !isString(nickname)
    ) {
      throw new BadGatewayException('Datos de vendedor inválidos');
    }
    return { id, nickname };
  }

  /** Guarda los tokens y calcula cuándo vence el acceso. */
  async saveTokens(
    seller: { id: number; nickname: string },
    tokens: MercadoLibreTokens,
  ): Promise<void> {
    const now = new Date();
    await this.supabaseService.saveConnection({
      seller_id: seller.id,
      nickname: seller.nickname,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(
        now.getTime() + tokens.expires_in * 1000,
      ).toISOString(),
      updated_at: now.toISOString(),
    });
  }

  /** Lee la cuenta conectada desde Supabase. */
  async getStoredConnection(): Promise<MercadoLibreConnection> {
    const connection = await this.supabaseService.getConnection();
    if (!connection) {
      throw new UnauthorizedException(
        'Primero conectá Mercado Libre desde /mercadolibre/connect',
      );
    }
    return connection;
  }

  /** Renueva el access token y guarda los nuevos tokens. */
  async refreshAccessToken(
    connection: MercadoLibreConnection,
  ): Promise<string> {
    const response = await this.requestJson(
      `${API_URL}/oauth/token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.getRequiredConfig('ML_CLIENT_ID'),
          client_secret: this.getRequiredConfig('ML_CLIENT_SECRET'),
          refresh_token: connection.refresh_token,
        }),
      },
      'tokenExchange',
    );
    const tokens = this.parseTokens(response);

    await this.saveTokens(
      { id: connection.seller_id, nickname: connection.nickname },
      tokens,
    );
    return tokens.access_token;
  }

  /** Devuelve un access token vigente o lo renueva automáticamente. */
  async getValidAccessToken(): Promise<string> {
    const connection = await this.getStoredConnection();
    const remainingTime = Date.parse(connection.expires_at) - Date.now();

    if (Number.isFinite(remainingTime) && remainingTime > 5 * 60 * 1000) {
      return connection.access_token;
    }
    return this.refreshAccessToken(connection);
  }

  /** Devuelve una página de User Products agrupados con sus MLA asociados. */
  async getPublicationsPage(page = 1, limit = 20) {
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor que cero');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }

    const connection = await this.getStoredConnection();
    const accessToken = await this.getValidAccessToken();

    // Primero obtenemos todos los MLA del vendedor usando scan + scroll_id.
    const ids = await this.getAllPublicationIds(
      connection.seller_id,
      accessToken,
    );

    // El multiget de Mercado Libre sigue trabajando internamente de 20 en 20.
    const batches = chunk(ids, MULTIGET_SIZE);
    const details: BatchResult[] = [];

    for (let index = 0; index < batches.length; index += MAX_CONCURRENT) {
      const currentBatches = batches.slice(index, index + MAX_CONCURRENT);
      details.push(
        ...(await Promise.all(
          currentBatches.map((batch) => this.fetchBatch(batch, accessToken)),
        )),
      );
    }

    const publications = details.flatMap((result) => result.publications);
    const errors = details.flatMap((result) => result.errors);

    // Agrupamos soportando los dos modelos de Mercado Libre:
    // FAMILY -> MLAU -> MLA y LEGACY -> variations[].
    // También detectamos publicaciones migradas donde el MLAU vive en variations[].
    const groups = await this.buildPublicationGroups(
      publications,
      accessToken,
    );

    // Recién después de agrupar aplicamos la paginación de la tabla.
    const offset = (page - 1) * limit;
    const pageGroups = groups.slice(offset, offset + limit);

    return {
      paging: {
        page,
        limit,
        total: groups.length,
        totalPages: Math.ceil(groups.length / limit),
      },
      totalItems: ids.length,
      count: pageGroups.length,
      publications: pageGroups,
      errors,
    };
  }

  /** Recorre el scan completo y devuelve todos los MLA del vendedor. */
  private async getAllPublicationIds(
    sellerId: number,
    accessToken: string,
  ): Promise<string[]> {
    const ids = new Set<string>();
    let scrollId: string | undefined;

    while (true) {
      const query = new URLSearchParams({
        search_type: 'scan',
        limit: '100',
      });

      if (scrollId) {
        query.set('scroll_id', scrollId);
      }

      const data = await this.requestJson<unknown>(
        `${API_URL}/users/${sellerId}/items/search?${query}`,
        { headers: this.auth(accessToken) },
        scrollId ? 'scroll' : undefined,
      );

      const scanPage = data === null ? { results: null } : data;
      if (!isObject(scanPage)) {
        throw new BadGatewayException('Respuesta de publicaciones inválida');
      }

      const results = scanPage.results === null ? [] : scanPage.results;
      if (!Array.isArray(results) || results.some((id) => !isString(id))) {
        throw new BadGatewayException('IDs de publicaciones inválidos');
      }

      if (results.length === 0) {
        break;
      }

      const previousSize = ids.size;
      for (const id of results as string[]) {
        ids.add(id);
      }

      const nextScrollId = isString(scanPage.scroll_id)
        ? scanPage.scroll_id
        : undefined;

      if (!nextScrollId) {
        throw new BadGatewayException('Mercado Libre no devolvió scroll_id');
      }

      if (ids.size === previousSize && nextScrollId === scrollId) {
        throw new BadGatewayException('El scan de Mercado Libre no avanzó');
      }

      scrollId = nextScrollId;
    }

    return [...ids];
  }

  /**
   * Agrupa publicaciones para el frontend.
   *
   * Modelo nuevo directo:
   * FAMILY -> MLAU -> MLA
   *
   * Modelo migrado/híbrido:
   * MLA -> variations[] -> MLAU -> FAMILY
   *
   * Modelo legacy real:
   * MLA -> variations[] sin MLAU
   */
  private async buildPublicationGroups(
    publications: JsonObject[],
    accessToken: string,
  ): Promise<PublicationGroup[]> {
    const userProductIds = new Set<string>();

    // Los MLAU pueden venir en la raíz del MLA o dentro de variations[].
    for (const publication of publications) {
      if (isString(publication.user_product_id)) {
        userProductIds.add(publication.user_product_id);
      }

      if (Array.isArray(publication.variations)) {
        for (const variation of publication.variations) {
          if (isObject(variation) && isString(variation.user_product_id)) {
            userProductIds.add(variation.user_product_id);
          }
        }
      }
    }

    // Consultamos cada MLAU para conocer su family_id.
    const metadata = new Map<string, UserProductMetadata>();
    const ids = [...userProductIds];

    for (let index = 0; index < ids.length; index += MAX_CONCURRENT) {
      const currentIds = ids.slice(index, index + MAX_CONCURRENT);

      const currentMetadata = await Promise.all(
        currentIds.map(async (userProductId) => {
          try {
            return await this.getUserProductMetadata(
              userProductId,
              accessToken,
            );
          } catch {
            // Si un MLAU viejo no responde, no tiramos abajo toda la página.
            return {
              id: userProductId,
              familyId: null,
              name: null,
              attributes: [],
              pictures: [],
            } satisfies UserProductMetadata;
          }
        }),
      );

      for (const userProduct of currentMetadata) {
        metadata.set(userProduct.id, userProduct);
      }
    }

    const families = new Map<string, FamilyPublicationGroup>();
    const legacyGroups: LegacyPublicationGroup[] = [];

    const addUserProductToFamily = (
      userProductId: string,
      publication: JsonObject,
      variation?: JsonObject,
    ): void => {
      const userProduct = metadata.get(userProductId);
      const familyId = userProduct?.familyId ?? null;

      // family_id manda. Si no existe, usamos el MLAU como fallback.
      const familyKey = familyId
        ? `family:${familyId}`
        : `user-product:${userProductId}`;

      let family = families.get(familyKey);

      if (!family) {
        family = {
          model: 'USER_PRODUCT',
          id: familyKey,
          familyId,
          familyName: isString(publication.family_name)
            ? publication.family_name
            : userProduct?.name ??
              (isString(publication.title) ? publication.title : null),
          userProducts: [],
        };

        families.set(familyKey, family);
      }

      let child = family.userProducts.find(
        (current) => current.id === userProductId,
      );

      if (!child) {
        child = {
          id: userProductId,
          name: userProduct?.name ?? null,
          attributes: userProduct?.attributes ?? [],
          pictures: userProduct?.pictures ?? [],
          publications: [],
        };
        family.userProducts.push(child);
      }

      // En el modelo migrado guardamos el MLA padre + la variación concreta.
      if (variation) {
        child.publications.push({
          id: publication.id,
          title: publication.title,
          status: publication.status,
          price: publication.price,
          base_price: publication.base_price,
          original_price: publication.original_price,
          currency_id: publication.currency_id,
          permalink: publication.permalink,
          thumbnail: publication.thumbnail,
          listing_type_id: publication.listing_type_id,
          variation: sanitize(variation),
        });
        return;
      }

      // Modelo nuevo directo: conservamos el MLA completo.
      child.publications.push(publication);
    };

    for (const publication of publications) {
      const itemId = isString(publication.id) ? publication.id : null;
      if (!itemId) continue;

      // CASO 1: MLA con user_product_id directo.
      if (isString(publication.user_product_id)) {
        addUserProductToFamily(
          publication.user_product_id,
          publication,
        );
        continue;
      }

      // CASO 2: MLA migrado. El MLAU vive dentro de variations[].
      const migratedVariations = Array.isArray(publication.variations)
        ? publication.variations.filter(
            (variation): variation is JsonObject =>
              isObject(variation) && isString(variation.user_product_id),
          )
        : [];

      if (migratedVariations.length > 0) {
        for (const variation of migratedVariations) {
          const userProductId = variation.user_product_id;
          if (!isString(userProductId)) continue;

          addUserProductToFamily(
            userProductId,
            publication,
            variation,
          );
        }
        continue;
      }

      // CASO 3: legacy verdadero. No tiene MLAU en ningún nivel.
      legacyGroups.push({
        model: 'LEGACY',
        id: itemId,
        itemId,
        title: isString(publication.title) ? publication.title : null,
        variations: Array.isArray(publication.variations)
          ? sanitize(publication.variations)
          : [],
        publication,
      });
    }

    return [...families.values(), ...legacyGroups];
  }

  /** Obtiene family_id y metadata básica de un MLAU. */
  private async getUserProductMetadata(
    userProductId: string,
    accessToken: string,
  ): Promise<UserProductMetadata> {
    const data = await this.requestJson<unknown>(
      `${API_URL}/user-products/${encodeURIComponent(userProductId)}`,
      { headers: this.auth(accessToken) },
    );

    if (!isObject(data) || data.id !== userProductId) {
      throw new BadGatewayException('Respuesta de User Product inválida');
    }

    const familyId =
      typeof data.family_id === 'number' && Number.isFinite(data.family_id)
        ? String(data.family_id)
        : isString(data.family_id)
          ? data.family_id
          : null;

    return {
      id: userProductId,
      familyId,
      name: isString(data.name) ? data.name : null,
      attributes: Array.isArray(data.attributes)
        ? sanitize(data.attributes)
        : [],
      pictures: Array.isArray(data.pictures)
        ? sanitize(data.pictures)
        : [],
    };
  }

  /** Consulta una publicación usando un access token vigente. */
  async getPublication(itemId: string) {
    const accessToken = await this.getValidAccessToken();
    const id = this.validateItemId(itemId);
    const [itemData, pricing] = await Promise.all([
      this.requestJson<unknown>(`${API_URL}/items/${encodeURIComponent(id)}`, {
        headers: this.auth(accessToken),
      }),
      this.getPricing(id, accessToken),
    ]);
    const item = sanitize(itemData);
    if (!isObject(item)) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }

    const {
      price,
      base_price: basePrice,
      original_price: originalPrice,
      ...itemWithoutLegacyPricing
    } = item;
    return {
      ...itemWithoutLegacyPricing,
      pricing: {
        ...pricing,
        currencyId:
          pricing.currencyId ??
          (isString(item.currency_id) ? item.currency_id : null),
      },
      legacyPricing: {
        price: typeof price === 'number' ? price : null,
        basePrice: typeof basePrice === 'number' ? basePrice : null,
        originalPrice: typeof originalPrice === 'number' ? originalPrice : null,
      },
    };
  }

  /** Consulta las promociones asociadas a una publicación. */
  async getItemPromotions(itemId: string) {
    const id = this.validateMlaItemId(itemId);
    const accessToken = await this.getValidAccessToken();
    const promotions = await this.fetchItemPromotions(id, accessToken);

    return {
      itemId: id,
      promotions,
      activePromotion:
        promotions.find((promotion) => this.isActivePromotion(promotion)) ??
        null,
    };
  }

  /** Crea únicamente un PRICE_DISCOUNT sin modificar el precio de lista. */
  async createPublicationPriceDiscount(
    itemId: string,
    input: CreatePriceDiscountDto,
  ) {
    const id = this.validateMlaItemId(itemId);
    const priceDiscount = this.validateStandalonePriceDiscount(input);
    const accessToken = await this.getValidAccessToken();

    const item = await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(id)}`,
      { headers: this.auth(accessToken) },
      'promotion',
    );
    if (!isObject(item) || item.id !== id || !isString(item.status)) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }
    if (item.status !== 'active' && item.status !== 'paused') {
      throw new BadRequestException(
        'La publicación debe estar activa o pausada',
      );
    }

    const standardPrice = await this.getPrices(id, accessToken, true);
    if (standardPrice.listPrice === null) {
      throw new BadGatewayException(
        'Mercado Libre no informó el precio standard',
      );
    }

    const promotions = await this.fetchItemPromotions(id, accessToken);
    const appliedPromotion = promotions.find((promotion) =>
      this.isActivePromotion(promotion),
    );
    if (appliedPromotion) {
      throw new ConflictException({
        ok: false,
        message: 'La publicación ya tiene una promoción aplicada',
        activePromotion: appliedPromotion,
      });
    }

    await this.createPriceDiscount(id, accessToken, priceDiscount);

    const pricing = await this.getPricing(id, accessToken, true);
    if (pricing.listPrice === null) {
      throw new BadGatewayException(
        'Mercado Libre no informó el precio standard después de crear la promoción',
      );
    }

    const finalPromotions = await this.fetchItemPromotions(id, accessToken);
    const promotion = finalPromotions.find(
      (currentPromotion) =>
        currentPromotion.type === 'PRICE_DISCOUNT' &&
        this.isActivePromotion(currentPromotion),
    );
    if (!promotion) {
      throw new BadGatewayException(
        'Mercado Libre no devolvió el PRICE_DISCOUNT creado',
      );
    }

    return {
      ok: true,
      itemId: id,
      pricing,
      promotion: {
        type: promotion.type,
        status: promotion.status,
      },
    };
  }

  /** Modifica el precio de una publicación. */
  async updatePublicationPrice(itemId: string, price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('El precio debe ser mayor que cero');
    }

    const accessToken = await this.getValidAccessToken();
    const id = this.validateItemId(itemId);
    await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price }),
      },
    );

    const pricing = await this.getPricing(id, accessToken);
    const result = {
      ok: true,
      itemId: id,
      requestedPrice: price,
      listPriceAfterUpdate: pricing.listPrice,
      salePriceAfterUpdate: pricing.salePrice,
      promotionRegularPrice: pricing.promotionRegularPrice,
      hasPromotion: pricing.hasPromotion,
    };

    return pricing.listPrice === price
      ? result
      : {
          ...result,
          warning: 'El precio standard no coincide con el precio solicitado',
        };
  }

  /** Actualiza el precio standard y la promoción compatible. */
  async updatePublicationPricing(itemId: string, input: UpdatePricingDto) {
    const id = this.validateMlaItemId(itemId);
    this.validatePricingInput(input);

    const accessToken = await this.getValidAccessToken();
    const item = await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(id)}`,
      { headers: this.auth(accessToken) },
      'promotion',
    );
    if (!isObject(item) || item.id !== id || !isString(item.status)) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }
    if (item.status !== 'active' && item.status !== 'paused') {
      throw new BadRequestException(
        'La publicación debe estar activa o pausada',
      );
    }

    const promotions = await this.fetchItemPromotions(id, accessToken);
    const activePromotions = promotions.filter((promotion) =>
      this.isActivePromotion(promotion),
    );
    const editableDeals = promotions.filter((promotion) =>
      this.isEditableDeal(promotion),
    );
    if (editableDeals.length > 0) {
      const deal = editableDeals[0];
      if (
        editableDeals.length > 1 ||
        activePromotions.some((promotion) => promotion !== deal)
      ) {
        throw new ConflictException({
          ok: false,
          message:
            'Hay más de una promoción activa y se requiere un flujo específico',
          activePromotions,
        });
      }
      return this.updateDealPricing(id, input, deal, accessToken);
    }

    const otherPromotion = activePromotions.find(
      (promotion) => promotion.type !== 'PRICE_DISCOUNT',
    );
    if (otherPromotion) {
      throw new ConflictException({
        ok: false,
        message:
          'La promoción activa no es PRICE_DISCOUNT y requiere un flujo específico',
        activePromotion: otherPromotion,
      });
    }

    const previousPromotion = activePromotions.find(
      (promotion) => promotion.type === 'PRICE_DISCOUNT',
    );
    const priceDiscountInput = this.validatePriceDiscountInput(input);
    if (previousPromotion && input.confirmPromotionReplace !== true) {
      throw new ConflictException({
        ok: false,
        requiresConfirmation: true,
        message: 'Existe un PRICE_DISCOUNT activo y debe reemplazarse',
        activePromotion: previousPromotion,
      });
    }

    await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price: input.listPrice }),
      },
      'promotion',
    );

    const standardPrice = await this.getPrices(id, accessToken, true);
    if (standardPrice.listPrice !== input.listPrice) {
      throw new BadGatewayException({
        message: 'El precio standard no coincide con el precio solicitado',
        requestedPrice: input.listPrice,
        listPriceAfterUpdate: standardPrice.listPrice,
      });
    }

    const priceDiscount: PriceDiscountRequest = {
      deal_price: input.salePrice,
      start_date: priceDiscountInput.startDate,
      finish_date: priceDiscountInput.finishDate,
      promotion_type: 'PRICE_DISCOUNT',
    };

    let previousPromotionDeleted = false;
    if (previousPromotion) {
      const currentPromotions = await this.fetchItemPromotions(id, accessToken);
      const currentPriceDiscount = currentPromotions.find(
        (promotion) =>
          promotion.type === 'PRICE_DISCOUNT' &&
          this.isActivePromotion(promotion),
      );
      if (currentPriceDiscount) {
        await this.deletePriceDiscount(id, accessToken);
      }
      previousPromotionDeleted = true;
    }

    try {
      await this.createPriceDiscount(id, accessToken, priceDiscount);
    } catch (error) {
      if (!previousPromotionDeleted || !previousPromotion) {
        throw error;
      }

      const status = error instanceof HttpException ? error.getStatus() : 502;
      const response =
        error instanceof HttpException ? error.getResponse() : undefined;
      const mercadoLibreError = sanitize(
        isObject(response)
          ? response
          : {
              message:
                typeof response === 'string'
                  ? response
                  : 'No se pudo conectar con Mercado Libre',
            },
      );

      throw new HttpException(
        {
          ok: false,
          listPriceUpdated: true,
          previousPromotionDeleted: true,
          newPromotionCreated: false,
          message:
            'Se actualizó el precio de lista, pero falló la creación de la nueva promoción',
          previousPromotion,
          mercadoLibreError,
        },
        status,
      );
    }

    const [pricing, finalPromotions] = await Promise.all([
      this.getPricing(id, accessToken, true),
      this.fetchItemPromotions(id, accessToken),
    ]);
    const finalPromotion = finalPromotions.find(
      (promotion) =>
        promotion.type === 'PRICE_DISCOUNT' &&
        this.isActivePromotion(promotion),
    );

    return {
      ok: true,
      itemId: id,
      requested: {
        listPrice: input.listPrice,
        salePrice: input.salePrice,
      },
      discountPercentage: priceDiscountInput.discountPercentage,
      pricing,
      promotion: finalPromotion ?? null,
    };
  }

  /** Retira un DEAL y crea un PRICE_DISCOUNT en un flujo separado. */
  async replaceDealWithPriceDiscount(itemId: string, input: ReplaceDealDto) {
    const id = this.validateMlaItemId(itemId);
    this.validatePricingInput(input);
    const priceDiscountInput = this.validatePriceDiscountInput(input);
    if (input.confirmReplaceDeal === false) {
      return {
        ok: true,
        preview: true,
        requiresConfirmation: true,
        message: 'Vista previa: no se realizó ningún cambio',
        itemId: id,
        requested: {
          listPrice: input.listPrice,
          salePrice: input.salePrice,
          startDate: priceDiscountInput.startDate,
          finishDate: priceDiscountInput.finishDate,
        },
        discountPercentage: priceDiscountInput.discountPercentage,
        operations: {
          removeCurrentDeal: true,
          updateListPrice: input.listPrice,
          createPriceDiscount: {
            salePrice: input.salePrice,
            startDate: priceDiscountInput.startDate,
            finishDate: priceDiscountInput.finishDate,
          },
        },
      };
    }
    if (input.confirmReplaceDeal !== true) {
      throw new BadRequestException(
        'confirmReplaceDeal debe ser un valor booleano',
      );
    }

    const accessToken = await this.getValidAccessToken();
    const item = await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(id)}`,
      { headers: this.auth(accessToken) },
      'promotion',
    );
    if (!isObject(item) || item.id !== id || !isString(item.status)) {
      throw new BadGatewayException('Respuesta de publicación inválida');
    }
    if (item.status !== 'active') {
      throw new BadRequestException(
        'La publicación debe estar activa para crear PRICE_DISCOUNT',
      );
    }

    const promotions = await this.fetchItemPromotions(id, accessToken);
    const editableDeals = promotions.filter((promotion) =>
      this.isEditableDeal(promotion),
    );
    if (editableDeals.length !== 1) {
      const candidateDeal = promotions.find(
        (promotion) =>
          promotion.type === 'DEAL' &&
          promotion.status.toLowerCase() === 'candidate',
      );
      throw new ConflictException({
        ok: false,
        message: candidateDeal
          ? 'El DEAL candidate no puede retirarse con esta ruta'
          : 'Debe existir exactamente un DEAL pending o started',
        ...(candidateDeal ? { promotion: candidateDeal } : {}),
      });
    }

    const previousDeal = editableDeals[0];
    if (!isString(previousDeal.id)) {
      throw new BadGatewayException(
        'Mercado Libre no informó el id de la promoción DEAL',
      );
    }
    const otherActivePromotion = promotions.find(
      (promotion) =>
        this.blocksPriceDiscountCreation(promotion) &&
        promotion !== previousDeal,
    );
    if (otherActivePromotion) {
      throw new ConflictException({
        ok: false,
        message:
          'Hay otra promoción activa y no es seguro crear PRICE_DISCOUNT',
        activePromotion: otherActivePromotion,
      });
    }

    const priceDiscount: PriceDiscountRequest = {
      deal_price: input.salePrice,
      start_date: priceDiscountInput.startDate,
      finish_date: priceDiscountInput.finishDate,
      promotion_type: 'PRICE_DISCOUNT',
    };

    await this.deleteDeal(id, previousDeal.id, accessToken);

    let dealRemovalVerified = false;
    let listPriceUpdated = false;
    let newPromotionRequestAccepted = false;
    let newPromotionCreated = false;
    try {
      const promotionsAfterDelete = await this.fetchItemPromotions(
        id,
        accessToken,
      );
      if (
        promotionsAfterDelete.some((promotion) =>
          this.isEditableDeal(promotion),
        )
      ) {
        throw new BadGatewayException(
          'Mercado Libre todavía informa un DEAL pending o started',
        );
      }
      dealRemovalVerified = true;
      const activeAfterDelete = promotionsAfterDelete.find((promotion) =>
        this.blocksPriceDiscountCreation(promotion),
      );
      if (activeAfterDelete) {
        throw new ConflictException({
          message:
            'Hay otra promoción activa y no es seguro crear PRICE_DISCOUNT',
          activePromotion: activeAfterDelete,
        });
      }

      await this.ensureStandardPrice(id, input.listPrice, accessToken);
      listPriceUpdated = true;

      const creationResult = await this.createPriceDiscount(
        id,
        accessToken,
        priceDiscount,
      );
      newPromotionRequestAccepted = true;
      if (
        !isObject(creationResult) ||
        typeof creationResult.price !== 'number' ||
        !Number.isFinite(creationResult.price)
      ) {
        throw new BadGatewayException(
          'Mercado Libre devolvió una respuesta inválida al crear PRICE_DISCOUNT',
        );
      }
      if (creationResult.price !== input.salePrice) {
        throw new BadGatewayException({
          message:
            'Mercado Libre no confirmó el precio solicitado para PRICE_DISCOUNT',
          requestedSalePrice: input.salePrice,
          confirmedSalePrice: creationResult.price,
        });
      }

      const [pricing, finalPromotions] = await Promise.all([
        this.getPricing(id, accessToken, true),
        this.fetchItemPromotions(id, accessToken),
      ]);
      if (finalPromotions.some((promotion) => this.isEditableDeal(promotion))) {
        dealRemovalVerified = false;
        throw new BadGatewayException(
          'Mercado Libre volvió a informar un DEAL pending o started',
        );
      }
      if (pricing.listPrice !== input.listPrice) {
        listPriceUpdated = false;
        throw new BadGatewayException({
          message: 'El precio standard no coincide con el precio solicitado',
          requestedPrice: input.listPrice,
          listPriceAfterUpdate: pricing.listPrice,
        });
      }

      const finalPromotion = finalPromotions.find((promotion) =>
        this.isCreatedPriceDiscount(promotion),
      );
      if (!finalPromotion) {
        throw new BadGatewayException(
          'Mercado Libre no devolvió el PRICE_DISCOUNT creado',
        );
      }
      newPromotionCreated = true;

      return {
        ok: true,
        itemId: id,
        dealDeleteAccepted: true,
        previousDealDeleted: true,
        listPriceUpdated: true,
        newPromotionRequestAccepted: true,
        newPromotionCreated: true,
        requested: {
          listPrice: input.listPrice,
          salePrice: input.salePrice,
        },
        discountPercentage: priceDiscountInput.discountPercentage,
        pricing,
        promotion: finalPromotion,
      };
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 502;
      const response =
        error instanceof HttpException ? error.getResponse() : undefined;
      const mercadoLibreError = sanitize(
        isObject(response)
          ? response
          : {
              message:
                typeof response === 'string'
                  ? response
                  : 'No se pudo conectar con Mercado Libre',
            },
      );
      const message = !dealRemovalVerified
        ? 'Mercado Libre aceptó el DELETE, pero no se pudo verificar el retiro del DEAL'
        : !listPriceUpdated
          ? 'El DEAL fue retirado, pero no se pudo continuar con el reemplazo'
          : !newPromotionRequestAccepted
            ? 'El DEAL fue retirado y el precio de lista quedó actualizado, pero falló la creación de PRICE_DISCOUNT'
            : 'La operación terminó, pero falló la verificación final';

      throw new HttpException(
        {
          ok: false,
          dealDeleteAccepted: true,
          previousDealDeleted: dealRemovalVerified,
          listPriceUpdated,
          newPromotionRequestAccepted,
          newPromotionCreated,
          message,
          previousDeal,
          mercadoLibreError,
        },
        status,
      );
    }
  }

  /** Devuelve un User Product con sus condiciones de venta y precios. */
  async getUserProductPrices(userProductId: string) {
    const id = userProductId.trim();
    if (!id.startsWith('MLAU')) {
      throw new BadRequestException('El userProductId debe comenzar con MLAU');
    }

    const accessToken = await this.getValidAccessToken();
    const connection = await this.getStoredConnection();
    const userProductData = await this.requestJson<unknown>(
      `${API_URL}/user-products/${encodeURIComponent(id)}`,
      { headers: this.auth(accessToken) },
    );
    if (
      !isObject(userProductData) ||
      userProductData.id !== id ||
      !isString(userProductData.name)
    ) {
      throw new BadGatewayException('Respuesta de User Product inválida');
    }

    const search = new URLSearchParams({ user_product_id: id });
    const searchData = await this.requestJson<unknown>(
      `${API_URL}/users/${connection.seller_id}/items/search?${search}`,
      { headers: this.auth(accessToken) },
    );
    if (
      !isObject(searchData) ||
      !Array.isArray(searchData.results) ||
      searchData.results.some(
        (itemId) => !isString(itemId) || !/^MLA\d+$/.test(itemId),
      )
    ) {
      throw new BadGatewayException('Respuesta de condiciones inválida');
    }

    const itemIds = [...new Set(searchData.results as string[])];
    if (itemIds.length === 0) {
      return { userProductId: id, conditions: [] };
    }

    const detailResults = await Promise.all(
      chunk(itemIds, MULTIGET_SIZE).map((batch) =>
        this.fetchBatch(batch, accessToken),
      ),
    );
    if (detailResults.some((result) => result.errors.length > 0)) {
      throw new BadGatewayException(
        'No se pudieron consultar todas las condiciones de venta',
      );
    }

    const items = detailResults.flatMap((result) => result.publications);
    const conditions = await Promise.all(
      items
        .slice(0, MAX_CONCURRENT)
        .map((item) => this.buildUserProductCondition(item, accessToken)),
    );
    for (
      let index = MAX_CONCURRENT;
      index < items.length;
      index += MAX_CONCURRENT
    ) {
      conditions.push(
        ...(await Promise.all(
          items
            .slice(index, index + MAX_CONCURRENT)
            .map((item) => this.buildUserProductCondition(item, accessToken)),
        )),
      );
    }

    const priority: Record<string, number> = {
      active: 0,
      paused: 1,
      closed: 2,
    };
    conditions.sort(
      (first, second) =>
        (priority[first.status] ?? 3) - (priority[second.status] ?? 3),
    );

    return {
      userProduct: {
        id,
        name: userProductData.name,
        familyId: userProductData.family_id ?? null,
        attributes: Array.isArray(userProductData.attributes)
          ? sanitize(userProductData.attributes)
          : [],
        pictures: Array.isArray(userProductData.pictures)
          ? sanitize(userProductData.pictures)
          : [],
      },
      conditions,
    };
  }

  /** Arma una condición de venta y consulta su precio cuando corresponde. */
  private async buildUserProductCondition(
    item: JsonObject,
    accessToken: string,
  ) {
    const itemId = isString(item.id) ? item.id : '';
    const status = isString(item.status) ? item.status : 'unknown';
    const currencyId = isString(item.currency_id) ? item.currency_id : null;
    const condition = {
      itemId,
      status,
      subStatus: Array.isArray(item.sub_status)
        ? item.sub_status.filter(isString)
        : [],
      listingType: isString(item.listing_type_id) ? item.listing_type_id : null,
      listPrice: null as number | null,
      salePrice: null as number | null,
      promotionRegularPrice: null as number | null,
      currencyId,
      hasPromotion: false,
      permalink: isString(item.permalink) ? item.permalink : null,
      legacyPricing: {
        priceFromItem:
          typeof item.price === 'number' && Number.isFinite(item.price)
            ? item.price
            : null,
        originalPriceFromItem:
          typeof item.original_price === 'number' &&
          Number.isFinite(item.original_price)
            ? item.original_price
            : null,
      },
    };

    if ((status !== 'active' && status !== 'paused') || !itemId) {
      return condition;
    }

    const pricing = await this.getPricing(itemId, accessToken);

    return {
      ...condition,
      ...pricing,
      currencyId: pricing.currencyId ?? currencyId,
    };
  }

  /** Modifica directamente una promoción DEAL sin eliminarla. */
  private async updateDealPricing(
    itemId: string,
    input: UpdatePricingDto,
    deal: ItemPromotion,
    accessToken: string,
  ) {
    if (!isString(deal.id)) {
      throw new BadGatewayException(
        'Mercado Libre no informó el id de la promoción DEAL',
      );
    }
    if (input.topDealPrice !== undefined && deal.topPrice === undefined) {
      throw new BadRequestException(
        'topDealPrice solo puede modificarse si DEAL ya tiene top_deal_price',
      );
    }

    await this.ensureStandardPrice(itemId, input.listPrice, accessToken);

    const body: DealUpdateRequest = {
      deal_price: input.salePrice,
      promotion_id: deal.id,
      promotion_type: 'DEAL',
    };
    if (input.topDealPrice !== undefined && deal.topPrice !== undefined) {
      body.top_deal_price = input.topDealPrice;
    }

    const updateResult = await this.requestJson<unknown>(
      `${API_URL}/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`,
      {
        method: 'PUT',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      'promotion',
    );
    if (
      !isObject(updateResult) ||
      typeof updateResult.price !== 'number' ||
      !Number.isFinite(updateResult.price)
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una respuesta inválida al modificar el DEAL',
      );
    }
    if (updateResult.price !== input.salePrice) {
      throw new BadGatewayException({
        message: 'Mercado Libre no confirmó el nuevo precio del DEAL',
        requestedSalePrice: input.salePrice,
        confirmedSalePrice: updateResult.price,
      });
    }
    const confirmedTopPrice =
      typeof updateResult.top_price === 'number'
        ? updateResult.top_price
        : typeof updateResult.top_deal_price === 'number'
          ? updateResult.top_deal_price
          : undefined;
    if (
      input.topDealPrice !== undefined &&
      confirmedTopPrice !== input.topDealPrice
    ) {
      throw new BadGatewayException({
        message: 'Mercado Libre no confirmó el nuevo topDealPrice del DEAL',
        requestedTopDealPrice: input.topDealPrice,
        confirmedTopDealPrice: confirmedTopPrice ?? null,
      });
    }

    const [pricing, finalPromotions] = await Promise.all([
      this.getPricing(itemId, accessToken, true),
      this.fetchItemPromotions(itemId, accessToken),
    ]);
    const finalDeal = finalPromotions.find(
      (promotion) => promotion.id === deal.id && this.isEditableDeal(promotion),
    );
    if (!finalDeal) {
      throw new BadGatewayException({
        message: 'Mercado Libre no devolvió el DEAL después de modificarlo',
        promotionId: deal.id,
      });
    }
    if (pricing.listPrice !== input.listPrice) {
      throw new BadGatewayException({
        message: 'El precio standard no coincide con el precio solicitado',
        requestedPrice: input.listPrice,
        listPriceAfterUpdate: pricing.listPrice,
      });
    }

    return {
      ok: true,
      itemId,
      promotion: {
        id: finalDeal.id,
        type: finalDeal.type,
        status: finalDeal.status,
        ...(finalDeal.name !== undefined ? { name: finalDeal.name } : {}),
      },
      pricing,
    };
  }

  /** Actualiza el precio standard solamente cuando todavía es distinto. */
  private async ensureStandardPrice(
    itemId: string,
    listPrice: number,
    accessToken: string,
  ): Promise<void> {
    const currentPrice = await this.getPrices(itemId, accessToken, true);
    if (currentPrice.listPrice === listPrice) return;

    await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PUT',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price: listPrice }),
      },
      'promotion',
    );

    const updatedPrice = await this.getPrices(itemId, accessToken, true);
    if (updatedPrice.listPrice !== listPrice) {
      throw new BadGatewayException({
        message: 'El precio standard no coincide con el precio solicitado',
        requestedPrice: listPrice,
        listPriceAfterUpdate: updatedPrice.listPrice,
      });
    }
  }

  /** Valida los datos antes de modificar precios o promociones. */
  private validatePricingInput(input: UpdatePricingDto): void {
    if (
      !input ||
      typeof input.listPrice !== 'number' ||
      !Number.isFinite(input.listPrice) ||
      input.listPrice <= 0
    ) {
      throw new BadRequestException('listPrice debe ser mayor que cero');
    }
    if (
      typeof input.salePrice !== 'number' ||
      !Number.isFinite(input.salePrice) ||
      input.salePrice <= 0
    ) {
      throw new BadRequestException('salePrice debe ser mayor que cero');
    }
    if (input.salePrice >= input.listPrice) {
      throw new BadRequestException('salePrice debe ser menor que listPrice');
    }
    if (
      input.topDealPrice !== undefined &&
      (typeof input.topDealPrice !== 'number' ||
        !Number.isFinite(input.topDealPrice) ||
        input.topDealPrice <= 0)
    ) {
      throw new BadRequestException('topDealPrice debe ser mayor que cero');
    }
    if (
      input.confirmPromotionReplace !== undefined &&
      typeof input.confirmPromotionReplace !== 'boolean'
    ) {
      throw new BadRequestException(
        'confirmPromotionReplace debe ser booleano',
      );
    }
  }

  /** Valida el precio y las fechas del nuevo PRICE_DISCOUNT. */
  private validateStandalonePriceDiscount(
    input: CreatePriceDiscountDto,
  ): PriceDiscountRequest {
    if (
      !input ||
      typeof input.salePrice !== 'number' ||
      !Number.isFinite(input.salePrice) ||
      input.salePrice <= 0
    ) {
      throw new BadRequestException('salePrice debe ser mayor que cero');
    }
    if (!isString(input.startDate) || !isString(input.finishDate)) {
      throw new BadRequestException('startDate y finishDate son obligatorias');
    }

    const startTime = Date.parse(input.startDate);
    const finishTime = Date.parse(input.finishDate);
    if (!Number.isFinite(startTime) || !Number.isFinite(finishTime)) {
      throw new BadRequestException('startDate y finishDate deben ser válidas');
    }
    if (finishTime <= startTime) {
      throw new BadRequestException(
        'finishDate debe ser posterior a startDate',
      );
    }
    if (finishTime - startTime > 14 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(
        'PRICE_DISCOUNT no puede durar más de 14 días',
      );
    }

    return {
      deal_price: input.salePrice,
      start_date: input.startDate,
      finish_date: input.finishDate,
      promotion_type: 'PRICE_DISCOUNT',
    };
  }

  /** Valida los datos exclusivos de un descuento PRICE_DISCOUNT. */
  private validatePriceDiscountInput(input: UpdatePricingDto): {
    startDate: string;
    finishDate: string;
    discountPercentage: number;
  } {
    if (input.topDealPrice !== undefined) {
      throw new BadRequestException(
        'topDealPrice solo aplica a promociones DEAL',
      );
    }
    if (!isString(input.startDate) || !isString(input.finishDate)) {
      throw new BadRequestException(
        'startDate y finishDate son obligatorias para PRICE_DISCOUNT',
      );
    }

    const discountPercentage =
      ((input.listPrice - input.salePrice) / input.listPrice) * 100;
    if (discountPercentage < 5 || discountPercentage >= 80) {
      throw new BadRequestException(
        'El descuento debe ser al menos 5% y menor que 80%',
      );
    }

    const startTime = Date.parse(input.startDate);
    const finishTime = Date.parse(input.finishDate);
    if (!Number.isFinite(startTime) || !Number.isFinite(finishTime)) {
      throw new BadRequestException('startDate y finishDate deben ser válidas');
    }
    if (finishTime <= startTime) {
      throw new BadRequestException(
        'finishDate debe ser posterior a startDate',
      );
    }
    if (finishTime - startTime > 14 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(
        'PRICE_DISCOUNT no puede durar más de 14 días',
      );
    }
    return {
      startDate: input.startDate,
      finishDate: input.finishDate,
      discountPercentage,
    };
  }

  /** Consulta y normaliza las promociones devueltas por Mercado Libre. */
  private async fetchItemPromotions(
    itemId: string,
    accessToken: string,
  ): Promise<ItemPromotion[]> {
    const data = await this.requestJson<unknown>(
      `${API_URL}/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`,
      { headers: this.auth(accessToken) },
      'promotion',
    );
    if (!Array.isArray(data)) {
      throw new BadGatewayException('Respuesta de promociones inválida');
    }

    return data.map((value) => {
      if (
        !isObject(value) ||
        !isString(value.type) ||
        !isString(value.status) ||
        (value.id !== undefined && typeof value.id !== 'string') ||
        (value.price !== undefined &&
          (typeof value.price !== 'number' || !Number.isFinite(value.price))) ||
        (value.top_deal_price !== undefined &&
          (typeof value.top_deal_price !== 'number' ||
            !Number.isFinite(value.top_deal_price))) ||
        (value.top_price !== undefined &&
          (typeof value.top_price !== 'number' ||
            !Number.isFinite(value.top_price))) ||
        (value.original_price !== undefined &&
          (typeof value.original_price !== 'number' ||
            !Number.isFinite(value.original_price))) ||
        (value.min_discounted_price !== undefined &&
          value.min_discounted_price !== null &&
          (typeof value.min_discounted_price !== 'number' ||
            !Number.isFinite(value.min_discounted_price))) ||
        (value.max_discounted_price !== undefined &&
          value.max_discounted_price !== null &&
          (typeof value.max_discounted_price !== 'number' ||
            !Number.isFinite(value.max_discounted_price))) ||
        (value.suggested_discounted_price !== undefined &&
          value.suggested_discounted_price !== null &&
          (typeof value.suggested_discounted_price !== 'number' ||
            !Number.isFinite(value.suggested_discounted_price))) ||
        (value.sub_type !== undefined &&
          value.sub_type !== null &&
          typeof value.sub_type !== 'string') ||
        (value.currency !== undefined &&
          value.currency !== null &&
          typeof value.currency !== 'string') ||
        (value.start_date !== undefined &&
          typeof value.start_date !== 'string') ||
        (value.finish_date !== undefined &&
          typeof value.finish_date !== 'string') ||
        (value.name !== undefined && typeof value.name !== 'string')
      ) {
        throw new BadGatewayException('Respuesta de promociones inválida');
      }

      const promotion: ItemPromotion = {
        type: value.type,
        status: value.status,
        minDiscountedPrice:
          typeof value.min_discounted_price === 'number'
            ? value.min_discounted_price
            : null,
        maxDiscountedPrice:
          typeof value.max_discounted_price === 'number'
            ? value.max_discounted_price
            : null,
        suggestedDiscountedPrice:
          typeof value.suggested_discounted_price === 'number'
            ? value.suggested_discounted_price
            : null,
        subType: typeof value.sub_type === 'string' ? value.sub_type : null,
        currency: typeof value.currency === 'string' ? value.currency : null,
      };
      if (typeof value.id === 'string') promotion.id = value.id;
      if (typeof value.price === 'number') promotion.price = value.price;
      if (typeof value.top_deal_price === 'number') {
        promotion.topPrice = value.top_deal_price;
      } else if (typeof value.top_price === 'number') {
        promotion.topPrice = value.top_price;
      }
      if (typeof value.original_price === 'number') {
        promotion.originalPrice = value.original_price;
      }
      if (typeof value.start_date === 'string') {
        promotion.startDate = value.start_date;
      }
      if (typeof value.finish_date === 'string') {
        promotion.finishDate = value.finish_date;
      }
      if (typeof value.name === 'string') promotion.name = value.name;

      return promotion;
    });
  }

  /** Considera aplicada solo una promoción started, pending, active o programmed. */
  private isActivePromotion(promotion: ItemPromotion): boolean {
    return ACTIVE_PROMOTION_STATUSES.has(promotion.status.toLowerCase());
  }

  /** Indica si un DEAL puede modificarse con el PUT de promociones. */
  private isEditableDeal(promotion: ItemPromotion): boolean {
    const status = promotion.status.toLowerCase();
    return (
      promotion.type === 'DEAL' &&
      (status === 'pending' || status === 'started')
    );
  }

  /** Indica si PRICE_DISCOUNT fue creado o está activándose. */
  private isCreatedPriceDiscount(promotion: ItemPromotion): boolean {
    const status = promotion.status.toLowerCase();
    return (
      promotion.type === 'PRICE_DISCOUNT' &&
      (status === 'started' ||
        status === 'pending' ||
        status === 'sync_requested')
    );
  }

  /** Evita crear otro descuento mientras existe una promoción incompatible. */
  private blocksPriceDiscountCreation(promotion: ItemPromotion): boolean {
    if (this.isActivePromotion(promotion)) return true;
    const status = promotion.status.toLowerCase();
    return (
      promotion.type === 'PRICE_DISCOUNT' &&
      (status === 'sync_requested' || status === 'restore_requested')
    );
  }

  /** Crea un descuento individual PRICE_DISCOUNT. */
  private async createPriceDiscount(
    itemId: string,
    accessToken: string,
    body: PriceDiscountRequest,
  ): Promise<unknown> {
    return this.requestJson<unknown>(
      `${API_URL}/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`,
      {
        method: 'POST',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      'promotion',
    );
  }

  /** Retira un ítem de un DEAL específico y exige HTTP 200. */
  private async deleteDeal(
    itemId: string,
    promotionId: string,
    accessToken: string,
  ): Promise<void> {
    const query = new URLSearchParams({
      promotion_type: 'DEAL',
      promotion_id: promotionId,
      app_version: 'v2',
    });
    let response: Response;
    try {
      response = await fetch(
        `${API_URL}/seller-promotions/items/${encodeURIComponent(itemId)}?${query}`,
        {
          method: 'DELETE',
          headers: this.auth(accessToken),
          signal: AbortSignal.timeout(TIMEOUT),
        },
      );
    } catch {
      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
    }

    if (response.status === 200) return;
    if (response.ok) {
      throw new BadGatewayException(
        'Mercado Libre no confirmó el retiro del DEAL con HTTP 200',
      );
    }

    const data = await readJson(response);
    this.throwApiError(
      response.status,
      'promotion',
      data === INVALID_JSON ? undefined : data,
    );
  }

  /** Elimina PRICE_DISCOUNT y exige la respuesta HTTP 200 documentada. */
  private async deletePriceDiscount(
    itemId: string,
    accessToken: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${API_URL}/seller-promotions/items/${encodeURIComponent(itemId)}?promotion_type=PRICE_DISCOUNT&app_version=v2`,
        {
          method: 'DELETE',
          headers: this.auth(accessToken),
          signal: AbortSignal.timeout(TIMEOUT),
        },
      );
    } catch {
      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
    }

    if (response.status === 200) return;
    if (response.ok) {
      throw new BadGatewayException(
        'Mercado Libre no confirmó la eliminación con HTTP 200',
      );
    }

    const data = await readJson(response);
    this.throwApiError(
      response.status,
      'promotion',
      data === INVALID_JSON ? undefined : data,
    );
  }

  /** Combina el precio standard y el precio final del comprador. */
  private async getPricing(
    itemId: string,
    accessToken: string,
    strict = false,
  ) {
    const standardPrice = await this.getPrices(itemId, accessToken, strict);
    const salePrice = await this.getSalePrice(itemId, accessToken, strict);
    const listPrice = standardPrice.listPrice;
    const finalSalePrice = salePrice.salePrice;
    const priceError = standardPrice.priceError ?? salePrice.priceError;

    return {
      listPrice,
      salePrice: finalSalePrice,
      promotionRegularPrice: salePrice.promotionRegularPrice,
      currencyId: standardPrice.currencyId ?? salePrice.currencyId,
      hasPromotion:
        finalSalePrice !== null &&
        listPrice !== null &&
        finalSalePrice < listPrice,
      ...(priceError ? { priceError } : {}),
    };
  }

  /** Obtiene el precio standard configurado para marketplace. */
  private async getPrices(
    itemId: string,
    accessToken: string,
    strict = false,
  ): Promise<{
    listPrice: number | null;
    currencyId?: string;
    priceError?: { status: number; message: string };
  }> {
    try {
      const data = await this.requestJson<unknown>(
        `${API_URL}/items/${encodeURIComponent(itemId)}/prices`,
        {
          headers: {
            ...this.auth(accessToken),
            'Content-Type': 'application/json',
          },
        },
        strict ? 'promotion' : 'prices',
      );
      if (
        !isObject(data) ||
        data.id !== itemId ||
        !Array.isArray(data.prices)
      ) {
        throw new BadGatewayException('Respuesta de precios inválida');
      }

      const prices = data.prices.filter(
        (price): price is MercadoLibrePriceNode =>
          isObject(price) &&
          price.type === 'standard' &&
          typeof price.amount === 'number' &&
          Number.isFinite(price.amount) &&
          isString(price.currency_id) &&
          isObject(price.conditions) &&
          Array.isArray(price.conditions.context_restrictions) &&
          price.conditions.context_restrictions.every(isString),
      );

      const response: MercadoLibrePricesResponse = { id: data.id, prices };
      const standardPrice =
        response.prices.find((price) =>
          price.conditions.context_restrictions.includes('channel_marketplace'),
        ) ??
        response.prices.find(
          (price) => price.conditions.context_restrictions.length === 0,
        ) ??
        response.prices[0];

      return {
        listPrice: standardPrice?.amount ?? null,
        currencyId: standardPrice?.currency_id,
      };
    } catch (error) {
      if (strict) throw error;
      return {
        listPrice: null,
        priceError: this.getPricingError(
          error,
          'No se pudo consultar el precio standard',
        ),
      };
    }
  }

  /** Consulta el precio real sin interrumpir las otras condiciones. */
  private async getSalePrice(
    itemId: string,
    accessToken: string,
    strict = false,
  ): Promise<SalePriceResult> {
    try {
      const data = await this.requestJson<unknown>(
        `${API_URL}/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`,
        { headers: this.auth(accessToken) },
        strict ? 'promotion' : 'salePrice',
      );
      if (
        !isObject(data) ||
        typeof data.amount !== 'number' ||
        !Number.isFinite(data.amount) ||
        (data.regular_amount !== null &&
          (typeof data.regular_amount !== 'number' ||
            !Number.isFinite(data.regular_amount))) ||
        !isString(data.currency_id)
      ) {
        throw new BadGatewayException('Respuesta de precio inválida');
      }

      const response: MercadoLibreSalePriceResponse = {
        amount: data.amount,
        regular_amount: data.regular_amount,
        currency_id: data.currency_id,
      };

      return {
        salePrice: response.amount,
        promotionRegularPrice: response.regular_amount,
        currencyId: response.currency_id,
      };
    } catch (error) {
      if (strict) throw error;
      return {
        salePrice: null,
        promotionRegularPrice: null,
        priceError: this.getPricingError(
          error,
          'No se pudo consultar el precio de venta',
        ),
      };
    }
  }

  /** Convierte un error de precios en una respuesta segura. */
  private getPricingError(error: unknown, fallback: string) {
    const status = error instanceof HttpException ? error.getStatus() : 502;
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const message =
      typeof response === 'string'
        ? response
        : isObject(response) && isString(response.message)
          ? response.message
          : fallback;

    return { status, message: message.slice(0, 500) };
  }

  /** Consulta hasta 20 ítems; un fallo no elimina los otros lotes. */
  private async fetchBatch(
  ids: string[],
  accessToken: string,
): Promise<BatchResult> {
  let response: Response;

  try {
    const query = new URLSearchParams({
      ids: ids.join(','),
    });

    response = await fetch(
      `${API_URL}/items?${query}`,
      {
        headers: this.auth(accessToken),
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
  } catch (error) {
    const code =
      isObject(error) &&
      error.name === 'TimeoutError'
        ? 504
        : 502;

    return batchError(
      ids,
      code,
      'No se pudieron obtener los detalles',
    );
  }

  const data = await readJson(response);

  if (data === INVALID_JSON) {
    return batchError(
      ids,
      response.ok ? 502 : response.status,
      'Mercado Libre devolvio JSON invalido',
    );
  }

  if (!response.ok) {
    return batchError(
      ids,
      response.status,
      sanitize(data),
    );
  }

  if (!Array.isArray(data)) {
    return batchError(
      ids,
      502,
      'Respuesta multiget invalida',
    );
  }

  const publications: JsonObject[] = [];
  const errors: ItemError[] = [];

  /*
   * Mapeamos por body.id cuando Mercado Libre lo informa.
   * En errores (por ejemplo 404) body puede no traer id; en ese caso
   * usamos la posición pedida como fallback para no convertirlo en 502.
   */
  const entriesById = new Map<string, MultigetEntry>();

  for (let index = 0; index < data.length; index += 1) {
    const rawEntry = data[index];
    if (!isObject(rawEntry)) continue;

    const entry = rawEntry as MultigetEntry;
    const body = entry.body;

    if (isObject(body) && isString(body.id)) {
      entriesById.set(body.id, entry);
      continue;
    }

    const requestedId = ids[index];
    if (requestedId && !entriesById.has(requestedId)) {
      entriesById.set(requestedId, entry);
    }
  }

  /*
   * Ahora recorremos los IDs pedidos
   * y buscamos su respuesta por ID.
   */
  for (const id of ids) {
    const entry = entriesById.get(id);

    if (!entry) {
      errors.push({
        id,
        code: 502,
        body: 'Mercado Libre no devolvio el item solicitado',
      });

      continue;
    }

    const code = validStatus(entry.code)
      ? entry.code
      : 502;

    const body = entry.body ?? null;

    if (
      code === 200 &&
      isObject(body) &&
      body.id === id
    ) {
      publications.push(
        sanitize(body),
      );
    } else {
      errors.push({
        id,
        code,
        body: sanitize(body),
      });
    }
  }

  return {
    publications,
    errors,
  };
}

  /** Valida y devuelve los tokens recibidos de Mercado Libre. */
  private parseTokens(response: unknown): MercadoLibreTokens {
    if (
      !isObject(response) ||
      !isString(response.access_token) ||
      !isString(response.refresh_token) ||
      !isPositiveInteger(response.expires_in) ||
      !isPositiveInteger(response.user_id)
    ) {
      throw new BadGatewayException('Mercado Libre devolvió tokens inválidos');
    }

    return {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_in: response.expires_in,
      user_id: response.user_id,
    };
  }

  /** Valida el identificador de una publicación. */
  private validateItemId(itemId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(itemId)) {
      throw new BadRequestException('El itemId es inválido');
    }
    return itemId;
  }

  /** Valida un identificador MLA para las rutas de promociones. */
  private validateMlaItemId(itemId: string): string {
    const id = typeof itemId === 'string' ? itemId.trim() : '';
    if (!/^MLA\d+$/.test(id)) {
      throw new BadRequestException('El itemId debe comenzar con MLA');
    }
    return id;
  }

  /** Crea un state aleatorio con una vigencia de diez minutos. */
  private createState(): string {
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now().toString();
    const payload = `${nonce}.${timestamp}`;

    return `${payload}.${this.signState(payload)}`;
  }

  /** Firma el contenido del state sin exponer el secreto. */
  private signState(payload: string): string {
    return createHmac('sha256', this.getStateSecret())
      .update(payload)
      .digest('base64url');
  }

  /** Lee y valida el secreto usado para firmar el state. */
  private getStateSecret(): string {
    const stateSecret = this.getRequiredConfig('ML_STATE_SECRET');
    if (Buffer.byteLength(stateSecret, 'utf8') < 32) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return stateSecret;
  }

  /** Lee y valida la URL exacta del callback OAuth. */
  private getRedirectUri(): string {
    const redirectUri = this.getRequiredConfig('ML_REDIRECT_URI');

    try {
      const parsedUrl = new URL(redirectUri);
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        throw new Error('Unsupported redirect protocol');
      }
    } catch {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return redirectUri;
  }

  /** Lee una variable obligatoria de Mercado Libre. */
  private getRequiredConfig(key: RequiredConfigKey): string {
    const value = this.configService.get<string>(key);
    if (!isString(value)) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return value.trim();
  }

  /** Ejecuta una llamada que debe responder JSON válido. */
  private async requestJson<T>(
    url: string,
    init: RequestInit,
    kind?: RequestKind,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch {
      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
    }

    const data = await readJson(response);
    if (data === INVALID_JSON) {
      if (!response.ok) this.throwApiError(response.status, kind);
      throw new BadGatewayException('Mercado Libre devolvió JSON inválido');
    }
    if (!response.ok) this.throwApiError(response.status, kind, data);
    return data as T;
  }

  /** Convierte estados externos en errores seguros de NestJS. */
  private throwApiError(
    status: number,
    kind?: RequestKind,
    data?: unknown,
  ): never {
    const safeData = sanitize(data);
    if (kind === 'tokenExchange' && (status === 400 || status === 401)) {
      const error = isObject(safeData) ? safeData.error : undefined;
      const message = isObject(safeData) ? safeData.message : undefined;

      throw new BadRequestException({
        message: 'Mercado Libre rechazó el intercambio OAuth',
        mercadoLibreError: isString(error)
          ? error.slice(0, 100)
          : 'unknown_error',
        mercadoLibreMessage: isString(message)
          ? message.slice(0, 500)
          : 'Mercado Libre no informó el motivo',
        status: 400,
      });
    }
    if (kind === 'promotion') {
      throw new HttpException(
        isObject(safeData)
          ? safeData
          : {
              message: 'Mercado Libre rechazó la operación de promociones',
            },
        status,
      );
    }
    if (kind === 'prices' || kind === 'salePrice') {
      const message =
        isObject(safeData) && isString(safeData.message)
          ? safeData.message.slice(0, 500)
          : 'Mercado Libre rechazó la consulta de precio';
      throw new HttpException(message, status);
    }
    if (kind === 'scroll' && (status === 400 || status === 404)) {
      throw new BadGatewayException('El scroll_id está ausente o venció');
    }
    if (status === 400) {
      throw new BadRequestException(
        isObject(safeData) ? safeData : 'Mercado Libre rechazó la solicitud',
      );
    }
    if (status === 401) {
      throw new UnauthorizedException('Acceso inválido o vencido');
    }
    if (status === 403) {
      throw new ForbiddenException('Permisos insuficientes');
    }
    if (status === 429) {
      throw new ServiceUnavailableException('Demasiadas solicitudes');
    }
    throw new BadGatewayException('Mercado Libre no completó la solicitud');
  }

  /** Crea el encabezado privado de autorización. */
  private auth(accessToken: string): HeadersInit {
    if (!accessToken?.trim()) {
      throw new BadRequestException('Token inválido');
    }
    return { Authorization: `Bearer ${accessToken}` };
  }
}

/** Indica si un valor es un objeto simple. */
function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Indica si un valor es texto válido. */
function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Indica si un valor es un entero positivo. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}


/** Indica si un valor puede ser un estado HTTP. */
function validStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

/** Lee una respuesta JSON sin perder los errores de parseo. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

/** Divide una lista en grupos del tamaño indicado. */
function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/** Convierte un error de lote en un error por publicación. */
function batchError(ids: string[], code: number, body: unknown): BatchResult {
  return {
    publications: [],
    errors: ids.map((id) => ({ id, code, body })),
  };
}

const PRIVATE_FIELDS = new Set([
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'authorization',
]);

/** Elimina credenciales si una API externa intentara devolverlas. */
function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !PRIVATE_FIELDS.has(key.toLowerCase().replaceAll(/[_-]/g, '')),
      )
      .map(([key, nested]) => [key, sanitize(nested)]),
  ) as T;
}