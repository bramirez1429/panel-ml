import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const AUTH_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_PATTERN = /^([\w-]{43})\.(\d{13})\.([\w-]{43})$/;
const STATE_TTL = 10 * 60 * 1000;
const TIMEOUT = 10_000;
const SCAN_SIZE = 100;
const MULTIGET_SIZE = 20;
const MAX_CONCURRENT = 4;
const INVALID_JSON = Symbol('invalid-json');
const OAUTH_ERRORS = new Set([
  'invalid_client',
  'invalid_grant',
  'invalid_operator_user_id',
  'invalid_request',
]);

type JsonObject = Record<string, unknown>;
type ConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';
type RequestKind = 'oauth' | 'scroll';
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

  /** Crea la URL para iniciar OAuth con un state firmado. */
  createAuthorizationUrl(): string {
    const state = this.createState();
    const verifier = this.createCodeVerifier(state);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.config('ML_CLIENT_ID'),
      redirect_uri: this.config('ML_REDIRECT_URI'),
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${query}`;
  }

  /** Valida la firma y los 10 minutos de vigencia del state. */
  verifyState(state: string): boolean {
    const match = STATE_PATTERN.exec(state);
    if (!match) return false;

    const [, nonce, timestamp, signature] = match;
    const age = Date.now() - Number(timestamp);
    if (age < 0 || age > STATE_TTL) return false;

    const expected = Buffer.from(
      this.sign(`${nonce}.${timestamp}`).toString('base64url'),
    );
    const received = Buffer.from(signature);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  /** Intercambia el code por un token que se usa solo en el backend. */
  async exchangeCode(code: string, state: string): Promise<string> {
    if (!code?.trim()) {
      throw new BadRequestException('Falta el codigo de autorizacion');
    }

    const data = await this.requestJson<JsonObject>(
      `${API_URL}/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config('ML_CLIENT_ID'),
          client_secret: this.config('ML_CLIENT_SECRET'),
          code,
          redirect_uri: this.config('ML_REDIRECT_URI'),
          code_verifier: this.createCodeVerifier(state),
        }),
      },
      'oauth',
    );

    if (!isString(data?.access_token)) {
      throw new BadGatewayException('Respuesta OAuth invalida');
    }
    return data.access_token;
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
    const value = `${randomBytes(32).toString('base64url')}.${Date.now()}`;
    return `${value}.${this.sign(value).toString('base64url')}`;
  }

  private createCodeVerifier(state: string): string {
    return createHmac('sha256', this.config('ML_STATE_SECRET'))
      .update(`pkce:${state}`)
      .digest('base64url');
  }

  private sign(value: string): Buffer {
    return createHmac('sha256', this.config('ML_STATE_SECRET'))
      .update(value)
      .digest();
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
    if (!response.ok) this.throwApiError(response.status, kind, data);
    return data as T;
  }

  /** Convierte estados externos en errores seguros de NestJS. */
  private throwApiError(
    status: number,
    kind?: RequestKind,
    body?: unknown,
  ): never {
    if (kind === 'oauth' && (status === 400 || status === 401)) {
      const code = safeOAuthError(body);
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: oauthErrorMessage(code),
        mercadoLibreError: code,
      });
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

  private config(key: ConfigKey): string {
    const value = this.configService.get<string>(key)?.trim();
    if (
      !value ||
      (key === 'ML_STATE_SECRET' && Buffer.byteLength(value) < 32)
    ) {
      throw new ServiceUnavailableException('Configuracion incompleta');
    }
    return value;
  }

  private auth(accessToken: string): HeadersInit {
    if (!accessToken?.trim()) {
      throw new BadRequestException('Token invalido');
    }
    return { Authorization: `Bearer ${accessToken}` };
  }
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

function safeOAuthError(body: unknown): string {
  const code = isObject(body) ? body.error : undefined;
  return isString(code) && OAUTH_ERRORS.has(code) ? code : 'oauth_error';
}

function oauthErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_grant':
      return 'El codigo OAuth no es valido. Inicia nuevamente desde /mercadolibre/connect y verifica ML_REDIRECT_URI';
    case 'invalid_client':
      return 'ML_CLIENT_ID y ML_CLIENT_SECRET no corresponden a la misma aplicacion';
    case 'invalid_operator_user_id':
      return 'Debes autorizar con la cuenta administradora de Mercado Libre';
    case 'invalid_request':
      return 'Solicitud OAuth invalida. Verifica redirect_uri y la configuracion PKCE';
    default:
      return 'Mercado Libre rechazo la autorizacion';
  }
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
