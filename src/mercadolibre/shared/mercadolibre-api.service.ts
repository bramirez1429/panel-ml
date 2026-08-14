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

const MUTATION_MESSAGES: Partial<Record<MercadoLibreRequestKind, string>> = {
  priceMutation: 'Mercado Libre no permitió modificar el precio',
  stockMutation: 'Mercado Libre no permitió modificar el stock',
  skuMutation: 'Mercado Libre no permitió modificar el SKU',
  statusMutation: 'Mercado Libre no permitió cambiar el estado',
  activationMutation: 'La publicación no puede activarse por su estado actual',
  picturesMutation: 'Mercado Libre no permitió modificar las fotos',
  titleMutation: 'Mercado Libre no permitió modificar el título',
  descriptionMutation: 'Mercado Libre no permitió modificar la descripción',
  attributesMutation: 'Mercado Libre no permitió modificar los atributos',
  promotionMutation: 'Mercado Libre no permitió modificar la promoción',
  publishingMutation: 'Mercado Libre no permitió crear la publicación',
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
      { method: 'GET', headers: this.headers(accessToken) },
      kind,
    );
  }

  /** Ejecuta un GET y representa 404 como ausencia, sin ocultar otros errores. */
  getOptional<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T | null> {
    return this.requestJson<T | null>(
      path,
      { method: 'GET', headers: this.headers(accessToken) },
      kind,
      true,
    );
  }

  /** Ejecuta un GET y devuelve los headers requeridos por recursos versionados. */
  getWithHeaders<T>(
    path: string,
    accessToken: string,
    notFoundAsNull = false,
  ): Promise<{ data: T | null; headers: Headers }> {
    return this.requestJsonWithHeaders<T>(
      path,
      { method: 'GET', headers: this.headers(accessToken) },
      undefined,
      notFoundAsNull,
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
        headers: this.headers(accessToken, true),
        body: JSON.stringify(body),
      },
      kind,
    );
  }

  /** Ejecuta un POST multipart sin fijar Content-Type manualmente. */
  postMultipart<T>(
    path: string,
    form: FormData,
    accessToken: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    return this.requestJson<T>(
      path,
      {
        method: 'POST',
        headers: this.headers(accessToken),
        body: form,
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
        headers: this.headers(accessToken, true),
        body: JSON.stringify(body),
      },
      kind,
    );
  }

  /** Ejecuta un PUT JSON con headers adicionales validados. */
  putWithHeaders<T>(
    path: string,
    body: unknown,
    accessToken: string,
    extraHeaders: Readonly<Record<string, string>>,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    const headers = this.headers(accessToken, true);
    for (const [name, value] of Object.entries(extraHeaders)) {
      headers.set(name, value);
    }
    return this.requestJson<T>(
      path,
      { method: 'PUT', headers, body: JSON.stringify(body) },
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
      { method: 'DELETE', headers: this.headers(accessToken) },
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
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    return this.requestJson<T>(
      path,
      { method: 'POST', headers, body: form },
      kind,
    );
  }

  /** Ejecuta una solicitud con timeout y valida su respuesta JSON. */
  private async requestJson<T>(
    path: string,
    init: RequestInit,
    kind?: MercadoLibreRequestKind,
    notFoundAsNull = false,
  ): Promise<T> {
    const response = await this.requestJsonWithHeaders<T>(
      path,
      init,
      kind,
      notFoundAsNull,
    );
    return response.data as T;
  }

  /** Ejecuta la solicitud conservando los headers seguros de la respuesta. */
  private async requestJsonWithHeaders<T>(
    path: string,
    init: RequestInit,
    kind?: MercadoLibreRequestKind,
    notFoundAsNull = false,
  ): Promise<{ data: T | null; headers: Headers }> {
    let response: Response;
    try {
      response = await fetch(this.buildUrl(path), {
        ...init,
        signal: AbortSignal.timeout(MERCADOLIBRE_REQUEST_TIMEOUT_MS),
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
      return { data: undefined as T, headers: response.headers };
    }
    if (response.status === 404 && notFoundAsNull) {
      return { data: null, headers: response.headers };
    }

    const data = await readJson(response);
    if (data === INVALID_JSON) {
      if (!response.ok) this.throwApiError(response.status, kind);
      throw new BadGatewayException('Mercado Libre devolvió JSON inválido');
    }
    if (!response.ok) this.throwApiError(response.status, kind, data);
    return { data: data as T, headers: response.headers };
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
  private headers(accessToken?: string, json = false): Headers {
    const headers = new Headers({ Accept: 'application/json' });
    if (accessToken !== undefined) {
      if (!isNonEmptyString(accessToken)) {
        throw new BadRequestException('Token inválido');
      }
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (json) headers.set('Content-Type', 'application/json');
    return headers;
  }

  /** Convierte errores externos en excepciones seguras. */
  private throwApiError(
    status: number,
    kind?: MercadoLibreRequestKind,
    data?: unknown,
  ): never {
    const safeData = sanitizeMercadoLibreData(data);
    if (kind === 'tokenExchange' && (status === 400 || status === 401)) {
      const error = isJsonObject(safeData) ? safeData.error : undefined;
      const message = isJsonObject(safeData) ? safeData.message : undefined;
      throw new BadRequestException({
        message: 'Mercado Libre rechazó el intercambio OAuth',
        mercadoLibreError: isNonEmptyString(error)
          ? error.slice(0, 100)
          : 'unknown_error',
        mercadoLibreMessage: isNonEmptyString(message)
          ? message.slice(0, 500)
          : 'Mercado Libre no informó el motivo',
        status: 400,
      });
    }
    if (kind === 'scroll' && (status === 400 || status === 404)) {
      throw new BadGatewayException('El scroll_id está ausente o venció');
    }
    if (kind === 'validation' && status === 400) {
      throw new BadRequestException(validationError(safeData));
    }
    const mutationMessage = kind ? MUTATION_MESSAGES[kind] : undefined;
    if (mutationMessage) {
      if (status === 400) throw new BadRequestException(mutationMessage);
      if (status === 401) throw new UnauthorizedException(mutationMessage);
      if (status === 403) throw new ForbiddenException(mutationMessage);
      if (status === 429) {
        throw new ServiceUnavailableException(mutationMessage);
      }
      throw new BadGatewayException(mutationMessage);
    }
    if (status === 400) {
      throw new BadRequestException('Mercado Libre rechazó la solicitud');
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
}

/** Conserva únicamente los campos de ML necesarios para mostrar validaciones. */
function validationError(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) {
    return { message: 'Mercado Libre rechazó la validación' };
  }
  const causes = Array.isArray(value.cause)
    ? value.cause.flatMap((cause) => {
        if (!isJsonObject(cause)) return [];
        return [
          {
            code: text(cause.code),
            message: text(cause.message),
            references: Array.isArray(cause.references)
              ? cause.references.filter(
                  (reference): reference is string =>
                    typeof reference === 'string',
                )
              : [],
          },
        ];
      })
    : [];
  return {
    message: text(value.message) ?? 'Mercado Libre rechazó la validación',
    ...(causes.length ? { cause: causes } : {}),
  };
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim().slice(0, 500) : null;
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

/** Elimina credenciales de una respuesta externa. */
export function sanitizeMercadoLibreData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sanitizeMercadoLibreData) as T;
  }
  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !PRIVATE_FIELDS.has(key.toLowerCase().replaceAll(/[_-]/g, '')),
      )
      .map(([key, nested]) => [key, sanitizeMercadoLibreData(nested)]),
  ) as T;
}
