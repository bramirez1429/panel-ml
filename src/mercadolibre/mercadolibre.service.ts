import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZATION_URL = 'https://auth.mercadolibre.com.ar/authorization';
const API_URL = 'https://api.mercadolibre.com';
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

type RequiredConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';

type MercadoLibreOperation =
  'tokenExchange' | 'currentUser' | 'publicationSearch' | 'publicationDetails';

interface MercadoLibreRecord {
  [key: string]: unknown;
}

export interface MercadoLibreSeller {
  id: number;
  nickname: string;
}

export interface MercadoLibrePublication {
  id: string;
  title: string;
  price: number;
  available_quantity: number;
  status: string;
  permalink: string;
  thumbnail: string;
}

export interface MercadoLibrePublicationsResult {
  total: number;
  publications: MercadoLibrePublication[];
}

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

  async getCurrentUser(accessToken: string): Promise<MercadoLibreSeller> {
    this.validateAccessToken(accessToken);

    const response = await this.requestJson(
      `${API_URL}/users/me`,
      { headers: this.createAuthorizationHeaders(accessToken) },
      'currentUser',
    );

    if (
      !isRecord(response) ||
      !isPositiveInteger(response.id) ||
      !isNonEmptyString(response.nickname)
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvió datos de vendedor inválidos',
      );
    }

    return { id: response.id, nickname: response.nickname };
  }

  async getPublications(
    userId: number,
    accessToken: string,
  ): Promise<MercadoLibrePublicationsResult> {
    if (!isPositiveInteger(userId)) {
      throw new BadRequestException(
        'El identificador del vendedor es inválido',
      );
    }
    this.validateAccessToken(accessToken);

    const searchUrl = new URL(`${API_URL}/users/${userId}/items/search`);
    searchUrl.search = new URLSearchParams({
      limit: '20',
      offset: '0',
    }).toString();

    const searchResponse = await this.requestJson(
      searchUrl.toString(),
      { headers: this.createAuthorizationHeaders(accessToken) },
      'publicationSearch',
    );
    const { ids, total } = this.parsePublicationSearch(searchResponse);

    if (ids.length === 0) {
      return { total, publications: [] };
    }

    const detailsUrl = new URL(`${API_URL}/items`);
    detailsUrl.searchParams.set('ids', ids.join(','));

    const detailsResponse = await this.requestJson(
      detailsUrl.toString(),
      { headers: this.createAuthorizationHeaders(accessToken) },
      'publicationDetails',
    );

    return {
      total,
      publications: this.parsePublicationDetails(detailsResponse),
    };
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

  private validateAccessToken(accessToken: string): void {
    if (!isNonEmptyString(accessToken)) {
      throw new BadRequestException('El token de acceso es inválido');
    }
  }

  private createAuthorizationHeaders(accessToken: string): HeadersInit {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    operation: MercadoLibreOperation,
  ): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('No se pudo conectar con Mercado Libre');
    }

    if (!response.ok) {
      this.throwMercadoLibreError(operation, response.status);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new BadGatewayException(
        'Mercado Libre devolvió una respuesta inválida',
      );
    }
  }

  private throwMercadoLibreError(
    operation: MercadoLibreOperation,
    status: number,
  ): never {
    if (status === 429) {
      throw new ServiceUnavailableException(
        'Mercado Libre limitó temporalmente las solicitudes',
      );
    }

    if (operation === 'tokenExchange' && (status === 400 || status === 401)) {
      throw new BadRequestException(
        'El código de autorización fue rechazado o venció',
      );
    }

    throw new BadGatewayException(
      'Mercado Libre no pudo completar la solicitud',
    );
  }

  private parsePublicationSearch(response: unknown): {
    ids: string[];
    total: number;
  } {
    if (
      !isRecord(response) ||
      !Array.isArray(response.results) ||
      !response.results.every(isNonEmptyString) ||
      !isRecord(response.paging) ||
      !isNonNegativeInteger(response.paging.total)
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una búsqueda de publicaciones inválida',
      );
    }

    return {
      ids: response.results.slice(0, 20),
      total: response.paging.total,
    };
  }

  private parsePublicationDetails(
    response: unknown,
  ): MercadoLibrePublication[] {
    if (!Array.isArray(response)) {
      throw new BadGatewayException(
        'Mercado Libre devolvió detalles de publicaciones inválidos',
      );
    }

    const publications = response.flatMap((entry) => {
      if (
        !isRecord(entry) ||
        entry.code !== 200 ||
        !isRecord(entry.body) ||
        !isPublication(entry.body)
      ) {
        return [];
      }

      return [
        {
          id: entry.body.id,
          title: entry.body.title,
          price: entry.body.price,
          available_quantity: entry.body.available_quantity,
          status: entry.body.status,
          permalink: entry.body.permalink,
          thumbnail: entry.body.thumbnail,
        },
      ];
    });

    if (publications.length === 0) {
      throw new BadGatewayException(
        'Mercado Libre no devolvió detalles válidos de las publicaciones',
      );
    }

    return publications;
  }
}

function isRecord(value: unknown): value is MercadoLibreRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPublication(
  value: MercadoLibreRecord,
): value is MercadoLibreRecord & MercadoLibrePublication {
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    isNonNegativeInteger(value.available_quantity) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.permalink) &&
    isNonEmptyString(value.thumbnail)
  );
}
