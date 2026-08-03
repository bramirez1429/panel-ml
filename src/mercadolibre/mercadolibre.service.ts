import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT = 10_000;
const SCAN_SIZE = 100;
const MULTIGET_SIZE = 20;
const MAX_CONCURRENT = 4;
const INVALID_JSON = Symbol('invalid-json');

type JsonObject = Record<string, unknown>;
type RequiredConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';
type RequestKind = 'tokenExchange' | 'scroll';
type ItemError = { id: string; code: number; body: unknown };
type BatchResult = {
  publications: JsonObject[];
  errors: ItemError[];
};
type ScanPage = {
  results?: unknown;
  scroll_id?: unknown;
  paging?: { total?: unknown };
};
type MultigetEntry = { code?: unknown; body?: unknown };

@Injectable()
export class MercadolibreService {
  constructor(private readonly configService: ConfigService) {}

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

  async exchangeCode(code: string): Promise<string> {
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

    if (!isRecord(response) || !isNonEmptyString(response.access_token)) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una respuesta de autorización inválida',
      );
    }

    // Discard every other response field, including refresh_token.
    return response.access_token;
  }

  /** Obtiene los datos basicos de la cuenta autorizada. */
  async getCurrentUser(accessToken: string) {
    const data = await this.requestJson<unknown>(`${API_URL}/users/me`, {
      headers: this.auth(accessToken),
    });
    if (!isObject(data)) {
      throw new BadGatewayException('Datos de vendedor invalidos');
    }
    const { id, nickname } = data;

    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !isString(nickname)
    ) {
      throw new BadGatewayException('Datos de vendedor invalidos');
    }
    return { id, nickname };
  }

  /** Obtiene todos los IDs y luego todos sus detalles. */
  async getAllPublications(userId: number, accessToken: string) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw new BadRequestException('ID de vendedor invalido');
    }

    const scan = await this.scanIds(userId, accessToken);
    const batches = chunk(scan.ids, MULTIGET_SIZE);
    const details: BatchResult[] = [];

    for (let index = 0; index < batches.length; index += MAX_CONCURRENT) {
      const group = batches.slice(index, index + MAX_CONCURRENT);
      details.push(
        ...(await Promise.all(
          group.map((ids) => this.fetchBatch(ids, accessToken)),
        )),
      );
    }

    const publications = details.flatMap((result) => result.publications);
    const errors = details.flatMap((result) => result.errors);
    return {
      totalReported: scan.total,
      idsRetrieved: scan.ids.length,
      publicationsRetrieved: publications.length,
      failed: errors.length,
      publications,
      errors,
    };
  }

  /** Reutiliza el primer scroll_id hasta que results quede vacio. */
  private async scanIds(
    userId: number,
    accessToken: string,
  ): Promise<{ ids: string[]; total: number }> {
    const ids = new Set<string>();
    let scrollId: string | undefined;
    let total: number | undefined;

    while (true) {
      const query = new URLSearchParams({
        search_type: 'scan',
        limit: String(SCAN_SIZE),
      });
      if (scrollId) query.set('scroll_id', scrollId);

      const data = await this.requestJson<unknown>(
        `${API_URL}/users/${userId}/items/search?${query}`,
        { headers: this.auth(accessToken) },
        scrollId ? 'scroll' : undefined,
      );
      if (!isObject(data)) {
        throw new BadGatewayException('Respuesta scan invalida');
      }
      const page = data as ScanPage;
      const results = page.results;

      const reported = page.paging?.total;
      if (
        total === undefined &&
        typeof reported === 'number' &&
        Number.isSafeInteger(reported) &&
        reported >= 0
      ) {
        total = reported;
      }

      if (results === null) break;
      if (
        !Array.isArray(results) ||
        results.some((id: unknown) => !isString(id))
      ) {
        throw new BadGatewayException('IDs de publicaciones invalidos');
      }
      if (results.length === 0) break;

      if (!scrollId) {
        if (!isString(page.scroll_id)) {
          throw new BadGatewayException('Mercado Libre no devolvio scroll_id');
        }
        scrollId = page.scroll_id;
      }
      (results as string[]).forEach((id) => ids.add(id));
    }

    return { ids: [...ids], total: total ?? ids.size };
  }

  /** Consulta hasta 20 items; un fallo no elimina los otros lotes. */
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
        'Mercado Libre devolvio JSON invalido',
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

  private createState(): string {
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now().toString();
    const payload = `${nonce}.${timestamp}`;

    return `${payload}.${this.signState(payload)}`;
  }

  private signState(payload: string): string {
    return createHmac('sha256', this.getStateSecret())
      .update(payload)
      .digest('base64url');
  }

  private getStateSecret(): string {
    const stateSecret = this.getRequiredConfig('ML_STATE_SECRET');
    if (Buffer.byteLength(stateSecret, 'utf8') < 32) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return stateSecret;
  }

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

  private getRequiredConfig(key: RequiredConfigKey): string {
    const value = this.configService.get<string>(key);
    if (!isNonEmptyString(value)) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }

    return value.trim();
  }

  /** Ejecuta una llamada que debe responder JSON valido. */
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
      throw new BadGatewayException('Mercado Libre devolvio JSON invalido');
    }
    if (!response.ok) this.throwApiError(response.status, kind);
    return data as T;
  }

  /** Convierte estados externos en errores seguros de NestJS. */
  private throwApiError(status: number, kind?: RequestKind): never {
    if (kind === 'tokenExchange' && (status === 400 || status === 401)) {
      throw new BadRequestException(
        'El código de autorización fue rechazado o venció',
      );
    }
    if (status === 401) {
      throw new UnauthorizedException('Acceso invalido o vencido');
    }
    if (status === 403) {
      throw new ForbiddenException('Permisos insuficientes');
    }
    if (status === 429) {
      throw new ServiceUnavailableException('Demasiadas solicitudes');
    }
    if (kind === 'scroll' && (status === 400 || status === 404)) {
      throw new BadGatewayException('El scroll_id esta ausente o vencio');
    }
    throw new BadGatewayException('Mercado Libre no completo la solicitud');
  }

  private auth(accessToken: string): HeadersInit {
    if (!accessToken?.trim()) {
      throw new BadRequestException('Token invalido');
    }
    return { Authorization: `Bearer ${accessToken}` };
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

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
