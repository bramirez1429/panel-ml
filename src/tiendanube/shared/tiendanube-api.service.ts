import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  getRequiredTiendanubeConfig,
  TIENDANUBE_API_URL,
  TIENDANUBE_API_VERSION,
  TIENDANUBE_OAUTH_TOKEN_URL,
  TIENDANUBE_REQUEST_TIMEOUT_MS,
  TiendanubeEnvironment,
} from './tiendanube.config';

const INVALID_JSON = Symbol('invalid-json');
const PRIVATE_FIELDS = new Set([
  'accesstoken',
  'authorization',
  'clientsecret',
  'refreshtoken',
]);

type TiendanubeHttpMethod = 'GET' | 'POST' | 'PUT';

type TiendanubeRequest = Readonly<{
  method: TiendanubeHttpMethod;
  accessToken?: string;
  body?: unknown;
}>;

export type TiendanubeOAuthTokenRequest = Readonly<{
  client_id: string;
  client_secret: string;
  grant_type: 'authorization_code';
  code: string;
}>;

type TiendanubeErrorContext = 'api' | 'oauth';

@Injectable()
export class TiendanubeApiService {
  constructor(
    private readonly configService: ConfigService<TiendanubeEnvironment>,
  ) {}

  get<T>(
    storeId: string | number,
    path: string,
    accessToken?: string,
  ): Promise<T | undefined> {
    return this.requestJson<T>(storeId, path, {
      method: 'GET',
      accessToken,
    });
  }

  post<T>(
    storeId: string | number,
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<T | undefined> {
    return this.requestJson<T>(storeId, path, {
      method: 'POST',
      accessToken,
      body,
    });
  }

  put<T>(
    storeId: string | number,
    path: string,
    body: unknown,
    accessToken?: string,
  ): Promise<T | undefined> {
    return this.requestJson<T>(storeId, path, {
      method: 'PUT',
      accessToken,
      body,
    });
  }

  /** Intercambia credenciales únicamente contra el endpoint OAuth oficial. */
  postOAuthToken<T>(
    request: TiendanubeOAuthTokenRequest,
  ): Promise<T | undefined> {
    return this.executeJsonRequest<T>(
      TIENDANUBE_OAUTH_TOKEN_URL,
      {
        method: 'POST',
        headers: this.buildHeaders(undefined, true),
        body: JSON.stringify(request),
        redirect: 'error',
        signal: AbortSignal.timeout(TIENDANUBE_REQUEST_TIMEOUT_MS),
      },
      [request.client_secret, request.code],
      'oauth',
    );
  }

  private async requestJson<T>(
    storeId: string | number,
    path: string,
    request: TiendanubeRequest,
  ): Promise<T | undefined> {
    const url = this.buildUrl(storeId, path);
    const init: RequestInit = {
      method: request.method,
      headers: this.buildHeaders(
        request.accessToken,
        request.body !== undefined,
      ),
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIENDANUBE_REQUEST_TIMEOUT_MS),
    };

    return this.executeJsonRequest<T>(
      url,
      init,
      request.accessToken ? [request.accessToken] : [],
      'api',
    );
  }

  private async executeJsonRequest<T>(
    url: string,
    init: RequestInit,
    sensitiveValues: readonly string[],
    errorContext: TiendanubeErrorContext,
  ): Promise<T | undefined> {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException(
          'Tiendanube no respondió dentro del tiempo esperado',
        );
      }

      throw new BadGatewayException('No se pudo conectar con Tiendanube');
    }

    if (response.status === 204) {
      return undefined;
    }

    const data = await readJson(response);

    if (data === INVALID_JSON) {
      if (!response.ok) {
        throwTiendanubeError(
          response.status,
          undefined,
          sensitiveValues,
          errorContext,
        );
      }

      throw new BadGatewayException(
        'Tiendanube devolvió una respuesta inválida',
      );
    }

    if (!response.ok) {
      throwTiendanubeError(
        response.status,
        data,
        sensitiveValues,
        errorContext,
      );
    }

    return data as T;
  }

  private buildHeaders(accessToken?: string, hasBody = false): Headers {
    const userAgent = getRequiredTiendanubeConfig(
      this.configService,
      'TIENDANUBE_USER_AGENT',
    );
    const headers = new Headers({
      Accept: 'application/json',
      'User-Agent': userAgent,
    });

    if (accessToken !== undefined) {
      if (!accessToken.trim()) {
        throw new BadRequestException('Token de Tiendanube inválido');
      }

      headers.set('Authorization', `Bearer ${accessToken.trim()}`);
    }

    if (hasBody) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
    }

    return headers;
  }

  private buildUrl(storeId: string | number, path: string): string {
    const normalizedStoreId = String(storeId).trim();

    if (
      (typeof storeId === 'number' &&
        (!Number.isSafeInteger(storeId) || storeId <= 0)) ||
      !/^[1-9]\d*$/.test(normalizedStoreId)
    ) {
      throw new BadRequestException('storeId de Tiendanube inválido');
    }

    const storePath = `/${TIENDANUBE_API_VERSION}/${encodeURIComponent(normalizedStoreId)}/`;
    const baseUrl = new URL(storePath, `${TIENDANUBE_API_URL}/`);
    const normalizedPath = path.replace(/^\/+/, '');
    const url = new URL(normalizedPath, baseUrl);

    if (
      url.origin !== TIENDANUBE_API_URL ||
      !url.pathname.startsWith(storePath)
    ) {
      throw new BadRequestException('Ruta de Tiendanube inválida');
    }

    return url.toString();
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

function throwTiendanubeError(
  status: number,
  data?: unknown,
  sensitiveValues: readonly string[] = [],
  context: TiendanubeErrorContext = 'api',
): never {
  const safeData = sanitizeTiendanubeData(data, sensitiveValues);
  const detail = extractTiendanubeMessage(safeData);
  const responseStatus = status >= 400 && status <= 599 ? status : 502;
  const message =
    context === 'oauth'
      ? detail
        ? `Tiendanube rechazó el intercambio OAuth: ${detail}`
        : 'Tiendanube rechazó el intercambio OAuth'
      : (detail ?? 'Tiendanube rechazó la solicitud');

  throw new HttpException(
    {
      statusCode: responseStatus,
      message,
      service: 'tiendanube',
    },
    responseStatus,
  );
}

function extractTiendanubeMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const message = value.trim();
    return message ? message.slice(0, 500) : null;
  }

  if (Array.isArray(value)) {
    const messages = value
      .map(extractTiendanubeMessage)
      .filter((message): message is string => message !== null);

    return messages.length > 0 ? messages.join(', ').slice(0, 500) : null;
  }

  if (!isJsonObject(value)) {
    return null;
  }

  const details = Object.entries(value)
    .filter(
      ([key]) =>
        ![
          'code',
          'description',
          'error',
          'message',
          'status',
          'statusCode',
          'status_code',
        ].includes(key),
    )
    .map(([key, nested]) => {
      const message = extractTiendanubeMessage(nested);
      return message ? `${key}: ${message}` : null;
    })
    .filter((detail): detail is string => detail !== null);

  const messages = [
    extractTiendanubeMessage(value.description),
    ...details,
    extractTiendanubeMessage(value.error),
    extractTiendanubeMessage(value.message),
  ].filter((message): message is string => message !== null);

  const uniqueMessages = [...new Set(messages)];

  return uniqueMessages.length > 0
    ? uniqueMessages.join('; ').slice(0, 500)
    : null;
}

function sanitizeTiendanubeData(
  value: unknown,
  sensitiveValues: readonly string[],
): unknown {
  if (typeof value === 'string') {
    return sensitiveValues.reduce((safeValue, sensitiveValue) => {
      const normalized = sensitiveValue.trim();
      return normalized
        ? safeValue.replaceAll(normalized, '[REDACTED]')
        : safeValue;
    }, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTiendanubeData(item, sensitiveValues));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !PRIVATE_FIELDS.has(key.toLowerCase().replaceAll(/[_-]/g, '')),
      )
      .map(([key, nested]) => [
        key,
        sanitizeTiendanubeData(nested, sensitiveValues),
      ]),
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    isJsonObject(error) &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
