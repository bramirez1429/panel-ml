import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  MERCADOLIBRE_API_URL,
  MERCADOLIBRE_REQUEST_TIMEOUT_MS,
} from './mercadolibre.config';

import {
  isJsonObject,
  isNonEmptyString,
  MercadoLibreRequestKind,
} from './mercadolibre.types';

const INVALID_JSON = Symbol('invalid-json');

const PRIVATE_FIELDS = new Set([
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'authorization',
]);

export type MercadolibreApiResponse<T> = {
  data: T;
  headers: Headers;
};

@Injectable()
export class MercadolibreApiService {
  /** Ejecuta un GET autenticado cuando recibe un token. */
  get<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'GET',
        headers: this.headers(accessToken),
      },
      kind,
    );
  }

  /** Ejecuta GET y también devuelve headers de respuesta. */
  getWithMeta<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<MercadolibreApiResponse<T>> {
    return this.requestJsonWithMeta<T>(
      path,
      {
        method: 'GET',
        headers: this.headers(accessToken),
      },
      kind,
    );
  }

  /** Ejecuta un POST con un body JSON. */
  post<T>(
    path: string,
    body: unknown,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers: this.headers(
          accessToken,
          true,
        ),
        body: JSON.stringify(body),
      },
      kind,
    );
  }

  /** Ejecuta un PUT con un body JSON. */
  put<T>(
    path: string,
    body: unknown,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'PUT',
        headers: this.headers(
          accessToken,
          true,
        ),
        body: JSON.stringify(body),
      },
      kind,
    );
  }

  /** Ejecuta PUT permitiendo headers adicionales. */
  putWithHeaders<T>(
    path: string,
    body: unknown,
    accessToken: string,
    extraHeaders: Record<string, string>,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'PUT',
        headers: this.headers(
          accessToken,
          true,
          extraHeaders,
        ),
        body: JSON.stringify(body),
      },
      kind,
    );
  }

  /** Ejecuta un DELETE sin exponer el token. */
  delete<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'DELETE',
        headers: this.headers(accessToken),
      },
      kind,
    );
  }

  /** Envía un formulario URL encoded sin credenciales en la URL. */
  postForm<T>(
    path: string,
    form: URLSearchParams,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type':
        'application/x-www-form-urlencoded',
    });

    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers,
        body: form,
      },
      kind,
    );
  }

  /** Ejecuta una solicitud y devuelve solamente el JSON. */
  private async requestJson<T>(
    path: string,
    init: RequestInit,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    const response =
      await this.requestJsonWithMeta<T>(
        path,
        init,
        kind,
      );

    return response.data;
  }

  /**
   * Ejecuta una solicitud y devuelve:
   * - data
   * - headers
   */
  private async requestJsonWithMeta<T>(
    path: string,
    init: RequestInit,
    kind?: MercadoLibreRequestKind,
  ): Promise<MercadolibreApiResponse<T>> {
    let response: Response;

    try {
      response = await fetch(
        this.buildUrl(path),
        {
          ...init,
          signal: AbortSignal.timeout(
            MERCADOLIBRE_REQUEST_TIMEOUT_MS,
          ),
        },
      );
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException(
          'Mercado Libre no respondió dentro del tiempo esperado',
        );
      }

      throw new BadGatewayException(
        'No se pudo conectar con Mercado Libre',
      );
    }

    if (response.status === 204) {
      return {
        data: undefined as T,
        headers: response.headers,
      };
    }

    const data = await readJson(response);

    if (data === INVALID_JSON) {
  if (!response.ok) {
    this.throwApiError(
      response.status,
      kind,
    );
  }

  return {
    data: undefined as T,
    headers: response.headers,
  };
}

    if (!response.ok) {
      this.throwApiError(
        response.status,
        kind,
        data,
      );
    }

    return {
      data: data as T,
      headers: response.headers,
    };
  }

  /** Construye una URL limitada al dominio de la API. */
  private buildUrl(
    path: string,
  ): string {
    const url = new URL(
      path,
      `${MERCADOLIBRE_API_URL}/`,
    );

    if (url.origin !== MERCADOLIBRE_API_URL) {
      throw new BadRequestException(
        'Ruta de Mercado Libre inválida',
      );
    }

    return url.toString();
  }

  /** Crea los encabezados comunes de Mercado Libre. */
  private headers(
    accessToken?: string,
    json = false,
    extraHeaders?: Record<string, string>,
  ): Headers {
    const headers = new Headers({
      Accept: 'application/json',
    });

    if (accessToken !== undefined) {
      if (!isNonEmptyString(accessToken)) {
        throw new BadRequestException(
          'Token inválido',
        );
      }

      headers.set(
        'Authorization',
        `Bearer ${accessToken}`,
      );
    }

    if (json) {
      headers.set(
        'Content-Type',
        'application/json',
      );
    }

    if (extraHeaders) {
      for (const [
        key,
        value,
      ] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  /** Convierte errores externos en excepciones seguras. */
  private throwApiError(
    status: number,
    kind?: MercadoLibreRequestKind,
    data?: unknown,
  ): never {
    const safeData =
      sanitizeMercadoLibreData(data);

    if (
      kind === 'tokenExchange' &&
      (status === 400 || status === 401)
    ) {
      const error = isJsonObject(safeData)
        ? safeData.error
        : undefined;

      const message = isJsonObject(safeData)
        ? safeData.message
        : undefined;

      throw new BadRequestException({
        message:
          'Mercado Libre rechazó el intercambio OAuth',

        mercadoLibreError:
          isNonEmptyString(error)
            ? error.slice(0, 100)
            : 'unknown_error',

        mercadoLibreMessage:
          isNonEmptyString(message)
            ? message.slice(0, 500)
            : 'Mercado Libre no informó el motivo',

        status: 400,
      });
    }

    if (
      kind === 'scroll' &&
      (status === 400 || status === 404)
    ) {
      throw new BadGatewayException(
        'El scroll_id está ausente o venció',
      );
    }

    if (status === 400) {
      throw new BadRequestException(
        isJsonObject(safeData)
          ? safeData
          : 'Mercado Libre rechazó la solicitud',
      );
    }

    if (status === 401) {
      throw new UnauthorizedException(
        'Acceso inválido o vencido',
      );
    }

    if (status === 403) {
      throw new ForbiddenException(
        'Permisos insuficientes',
      );
    }

    if (status === 429) {
      throw new ServiceUnavailableException(
        'Demasiadas solicitudes',
      );
    }

    throw new BadGatewayException(
      'Mercado Libre no completó la solicitud',
    );
  }
}

/** Lee JSON sin ocultar errores de parseo. */
async function readJson(
  response: Response,
): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

/** Indica si una solicitud agotó el tiempo. */
function isTimeoutError(
  error: unknown,
): boolean {
  return (
    isJsonObject(error) &&
    (
      error.name === 'TimeoutError' ||
      error.name === 'AbortError'
    )
  );
}

/** Elimina credenciales de una respuesta externa. */
export function sanitizeMercadoLibreData<T>(
  value: T,
): T {
  if (Array.isArray(value)) {
    return value.map(
      sanitizeMercadoLibreData,
    ) as T;
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !PRIVATE_FIELDS.has(
            key
              .toLowerCase()
              .replaceAll(/[_-]/g, ''),
          ),
      )
      .map(
        ([key, nested]) => [
          key,
          sanitizeMercadoLibreData(nested),
        ],
      ),
  ) as T;
}