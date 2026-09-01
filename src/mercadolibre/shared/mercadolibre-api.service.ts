import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
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
import { throwMercadolibreApiError } from './mercadolibre-api-error.helpers';

export { sanitizeMercadoLibreData } from './mercadolibre-api-error.helpers';

const INVALID_JSON = Symbol('invalid-json');

export type MercadolibreApiResponse<T> = {
  data: T;
  headers: Headers;
};

export type MercadolibreApiRequestOptions = {
  timeoutMs?: number;
};

@Injectable()
export class MercadolibreApiService {
  /** Ejecuta un GET autenticado cuando recibe un token. */
  get<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'GET',
        headers: this.headers(accessToken),
      },
      kind,
      options,
    );
  }

  /** Ejecuta GET y también devuelve headers de respuesta. */
  getWithMeta<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<MercadolibreApiResponse<T>> {
    return this.requestJsonWithMeta<T>(
      path,
      {
        method: 'GET',
        headers: this.headers(accessToken),
      },
      kind,
      options,
    );
  }

  /** Ejecuta un POST con un body JSON. */
  post<T>(
    path: string,
    body: unknown,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers: this.headers(accessToken, true),
        body: JSON.stringify(body),
      },
      kind,
      options,
    );
  }

  /** Ejecuta un PUT con un body JSON. */
  put<T>(
    path: string,
    body: unknown,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'PUT',
        headers: this.headers(accessToken, true),
        body: JSON.stringify(body),
      },
      kind,
      options,
    );
  }

  /** Ejecuta PUT permitiendo headers adicionales. */
  putWithHeaders<T>(
    path: string,
    body: unknown,
    accessToken: string,
    extraHeaders: Record<string, string>,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'PUT',
        headers: this.headers(accessToken, true, extraHeaders),
        body: JSON.stringify(body),
      },
      kind,
      options,
    );
  }

  /** Ejecuta un DELETE sin exponer el token. */
  delete<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'DELETE',
        headers: this.headers(accessToken),
      },
      kind,
      options,
    );
  }

  /** Envía un formulario URL encoded sin credenciales en la URL. */
  postForm<T>(
    path: string,
    form: URLSearchParams,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers,
        body: form,
      },
      kind,
      options,
    );
  }

  /** Envía multipart sin fijar el boundary que administra FormData. */
  postMultipart<T>(
    path: string,
    form: FormData,
    accessToken: string,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers: this.headers(accessToken),
        body: form,
      },
      kind,
      options,
    );
  }

  /** Ejecuta una solicitud y devuelve solamente el JSON. */
  private async requestJson<T>(
    path: string,
    init: RequestInit,
    kind?: MercadoLibreRequestKind,
    options?: MercadolibreApiRequestOptions,
  ): Promise<T> {
    const response = await this.requestJsonWithMeta<T>(
      path,
      init,
      kind,
      options,
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
    options?: MercadolibreApiRequestOptions,
  ): Promise<MercadolibreApiResponse<T>> {
    let response: Response;
    const timeoutMs = this.requestTimeout(options);

    try {
      response = await fetch(this.buildUrl(path), {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException(
          'Mercado Libre no respondió dentro del tiempo esperado',
        );
      }

      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
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
        throwMercadolibreApiError(response.status, kind);
      }
      throw new BadGatewayException(
        'Mercado Libre devolvi\u00f3 una respuesta inv\u00e1lida',
      );
    }

    if (!response.ok) {
      throwMercadolibreApiError(response.status, kind, data);
    }

    return {
      data: data as T,
      headers: response.headers,
    };
  }

  /** Construye una URL limitada al dominio de la API. */
  private buildUrl(path: string): string {
    const url = new URL(path, `${MERCADOLIBRE_API_URL}/`);

    if (url.origin !== MERCADOLIBRE_API_URL) {
      throw new BadRequestException('Ruta de Mercado Libre inválida');
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
        throw new BadRequestException('Token inválido');
      }

      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    if (json) {
      headers.set('Content-Type', 'application/json');
    }

    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  private requestTimeout(options?: MercadolibreApiRequestOptions): number {
    const timeoutMs = options?.timeoutMs ?? MERCADOLIBRE_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new BadRequestException('timeoutMs debe ser un entero positivo');
    }
    return timeoutMs;
  }
}

/** Lee JSON sin ocultar errores de parseo. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

/** Indica si una solicitud agotó el tiempo. */
function isTimeoutError(error: unknown): boolean {
  return (
    isJsonObject(error) &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
