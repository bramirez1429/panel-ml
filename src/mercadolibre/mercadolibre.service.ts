import {
  BadGatewayException,
  BadRequestException,
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

const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT = 10_000;
const MULTIGET_SIZE = 20;
const MAX_CONCURRENT = 4;
const INVALID_JSON = Symbol('invalid-json');

type JsonObject = Record<string, unknown>;
type RequiredConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';
type RequestKind = 'tokenExchange' | 'scroll' | 'salePrice';
type ItemError = { id: string; code: number; body: unknown };
type BatchResult = {
  publications: JsonObject[];
  errors: ItemError[];
};
type MultigetEntry = { code?: unknown; body?: unknown };
type MercadoLibreTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};
type SalePriceResult = {
  salePrice: number | null;
  regularPrice: number | null;
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

  /** Devuelve una página de publicaciones y el scroll para continuar. */
  async getPublicationsPage(limit = 50, scrollId?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }

    const connection = await this.getStoredConnection();
    const accessToken = await this.getValidAccessToken();
    const query = new URLSearchParams({
      search_type: 'scan',
      limit: String(limit),
    });
    if (scrollId) query.set('scroll_id', scrollId);

    const data = await this.requestJson<unknown>(
      `${API_URL}/users/${connection.seller_id}/items/search?${query}`,
      { headers: this.auth(accessToken) },
      scrollId ? 'scroll' : undefined,
    );
    const page = data === null ? { results: null } : data;
    if (!isObject(page)) {
      throw new BadGatewayException('Respuesta de publicaciones inválida');
    }

    const results = page.results === null ? [] : page.results;
    if (!Array.isArray(results) || results.some((id) => !isString(id))) {
      throw new BadGatewayException('IDs de publicaciones inválidos');
    }

    const reportedTotal = isObject(page.paging) ? page.paging.total : null;
    const total = isNonNegativeInteger(reportedTotal) ? reportedTotal : null;

    const ids = [...new Set(results as string[])];
    const activeScrollId =
      scrollId ?? (isString(page.scroll_id) ? page.scroll_id : undefined);
    if (ids.length > 0 && !activeScrollId) {
      throw new BadGatewayException('Mercado Libre no devolvió scroll_id');
    }

    const batches = chunk(ids, MULTIGET_SIZE);
    const details: BatchResult[] = [];
    for (let index = 0; index < batches.length; index += MAX_CONCURRENT) {
      const group = batches.slice(index, index + MAX_CONCURRENT);
      details.push(
        ...(await Promise.all(
          group.map((batch) => this.fetchBatch(batch, accessToken)),
        )),
      );
    }

    const finished = ids.length === 0;
    return {
      total,
      count: ids.length,
      nextScrollId: finished ? null : activeScrollId,
      finished,
      publications: details.flatMap((result) => result.publications),
      errors: details.flatMap((result) => result.errors),
    };
  }

  /** Consulta una publicación usando un access token vigente. */
  async getPublication(itemId: string) {
    const accessToken = await this.getValidAccessToken();
    const data = await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(this.validateItemId(itemId))}`,
      { headers: this.auth(accessToken) },
    );
    return sanitize(data);
  }

  /** Modifica el precio de una publicación. */
  async updatePublicationPrice(itemId: string, price: number) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('El precio debe ser mayor que cero');
    }

    const accessToken = await this.getValidAccessToken();
    const data = await this.requestJson<unknown>(
      `${API_URL}/items/${encodeURIComponent(this.validateItemId(itemId))}`,
      {
        method: 'PUT',
        headers: {
          ...this.auth(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price }),
      },
    );
    return sanitize(data);
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
      priceFromItem:
        typeof item.price === 'number' && Number.isFinite(item.price)
          ? item.price
          : null,
      salePrice: null as number | null,
      regularPrice: null as number | null,
      currencyId,
      permalink: isString(item.permalink) ? item.permalink : null,
    };

    if ((status !== 'active' && status !== 'paused') || !itemId) {
      return condition;
    }

    const salePrice = await this.getSalePrice(itemId, accessToken);
    return {
      ...condition,
      ...salePrice,
      currencyId: salePrice.currencyId ?? currencyId,
    };
  }

  /** Consulta el precio real sin interrumpir las otras condiciones. */
  private async getSalePrice(
    itemId: string,
    accessToken: string,
  ): Promise<SalePriceResult> {
    try {
      const data = await this.requestJson<unknown>(
        `${API_URL}/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`,
        { headers: this.auth(accessToken) },
        'salePrice',
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

      return {
        salePrice: data.amount,
        regularPrice: data.regular_amount,
        currencyId: data.currency_id,
      };
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 502;
      const response =
        error instanceof HttpException ? error.getResponse() : undefined;
      const message =
        typeof response === 'string'
          ? response
          : isObject(response) && isString(response.message)
            ? response.message
            : 'No se pudo consultar el precio de venta';

      return {
        salePrice: null,
        regularPrice: null,
        priceError: { status, message: message.slice(0, 500) },
      };
    }
  }

  /** Consulta hasta 20 ítems; un fallo no elimina los otros lotes. */
  private async fetchBatch(
    ids: string[],
    accessToken: string,
  ): Promise<BatchResult> {
    let response: Response;
    try {
      const query = new URLSearchParams({ ids: ids.join(',') });
      response = await fetch(`${API_URL}/items?${query}`, {
        headers: this.auth(accessToken),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (error) {
      const code = isObject(error) && error.name === 'TimeoutError' ? 504 : 502;
      return batchError(ids, code, 'No se pudieron obtener los detalles');
    }

    const data = await readJson(response);
    if (data === INVALID_JSON) {
      return batchError(
        ids,
        response.ok ? 502 : response.status,
        'Mercado Libre devolvió JSON inválido',
      );
    }
    if (!response.ok) {
      return batchError(ids, response.status, sanitize(data));
    }
    if (!Array.isArray(data)) {
      return batchError(ids, 502, 'Respuesta multiget invalida');
    }

    const publications: JsonObject[] = [];
    const errors: ItemError[] = [];
    ids.forEach((id, index) => {
      const entry = data[index] as MultigetEntry | undefined;
      const code = validStatus(entry?.code) ? entry.code : 502;
      const body = entry?.body ?? null;

      if (code === 200 && isObject(body) && body.id === id) {
        publications.push(sanitize(body));
      } else {
        errors.push({
          id,
          code: code === 200 ? 502 : code,
          body: sanitize(body),
        });
      }
    });
    return { publications, errors };
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
    if (kind === 'salePrice') {
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

/** Indica si un valor es un entero no negativo. */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
