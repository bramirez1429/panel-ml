import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import {
  getRequiredTiendanubeConfig,
  TIENDANUBE_APPS_URL,
  TiendanubeEnvironment,
  TIENDANUBE_OAUTH_STATE_TTL_MS,
} from '../shared/tiendanube.config';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';

const APP_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_TIMESTAMP_PATTERN = /^\d{13}$/;
const STATE_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BROWSER_BINDING_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_BROWSER_COOKIE_PREFIX = 'tiendanube_oauth_binding_';
const STATE_KEY_CONTEXT = 'tiendanube-oauth-state-v1';

export type TiendanubeAuthorizationRequest = Readonly<{
  url: string;
  cookieName: string;
  cookiePath: string;
  browserBinding: string;
  secureCookie: boolean;
}>;

type TiendanubeOAuthTokenResponse = Readonly<{
  access_token: string;
  token_type: 'bearer';
  scope: string;
  user_id: string | number;
}>;

export type TiendanubeOAuthResult = Readonly<{
  storeId: string;
  scope: string;
}>;

@Injectable()
export class TiendanubeOAuthService {
  constructor(
    private readonly configService: ConfigService<TiendanubeEnvironment>,
    private readonly apiService: TiendanubeApiService,
    private readonly connectionRepository: TiendanubeConnectionRepository,
  ) {}

  /** Genera una autorización firmada y ligada al navegador del usuario. */
  createAuthorizationRequest(userId: string): TiendanubeAuthorizationRequest {
    this.requireAppUserId(userId);

    const browserBinding = randomBytes(32).toString('base64url');
    const bindingHash = this.hashBrowserBinding(browserBinding);
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now().toString();
    const state = this.createState(userId, nonce, timestamp, bindingHash);
    const clientId = this.getRequiredConfig('TIENDANUBE_CLIENT_ID');
    const authorizationUrl = new URL(
      `${TIENDANUBE_APPS_URL}/${encodeURIComponent(clientId)}/authorize`,
    );
    authorizationUrl.searchParams.set('state', state);

    const redirectUri = this.getRedirectUri();

    return {
      url: authorizationUrl.toString(),
      cookieName: `${OAUTH_BROWSER_COOKIE_PREFIX}${nonce}`,
      cookiePath: redirectUri.pathname || '/',
      browserBinding,
      secureCookie: redirectUri.protocol === 'https:',
    };
  }

  /** Obtiene la cookie aislada de un state con formato válido. */
  getAuthorizationCookieName(state: string): string | null {
    const parts = state.split('.');
    if (parts.length !== 5 || !STATE_NONCE_PATTERN.test(parts[1])) return null;
    return `${OAUTH_BROWSER_COOKIE_PREFIX}${parts[1]}`;
  }

  getCallbackCookiePath(): string {
    return this.getRedirectUri().pathname || '/';
  }

  /** Verifica firma, expiración y navegador, y recupera el userId iniciador. */
  verifyState(state: string, browserBinding?: string): string | null {
    if (!browserBinding || !BROWSER_BINDING_PATTERN.test(browserBinding)) {
      return null;
    }

    const parts = state.split('.');
    if (parts.length !== 5) return null;

    const [userId, nonce, timestampValue, receivedBindingHash, signature] =
      parts;
    if (
      !APP_USER_ID_PATTERN.test(userId) ||
      !STATE_NONCE_PATTERN.test(nonce) ||
      !STATE_TIMESTAMP_PATTERN.test(timestampValue) ||
      !STATE_HASH_PATTERN.test(receivedBindingHash) ||
      !STATE_HASH_PATTERN.test(signature)
    ) {
      return null;
    }

    const timestamp = Number(timestampValue);
    const age = Date.now() - timestamp;
    if (
      !Number.isSafeInteger(timestamp) ||
      age < 0 ||
      age > TIENDANUBE_OAUTH_STATE_TTL_MS
    ) {
      return null;
    }

    const payload = `${userId}.${nonce}.${timestampValue}.${receivedBindingHash}`;
    if (!safeEqualBase64Url(signature, this.signState(payload))) return null;

    const expectedBindingHash = this.hashBrowserBinding(browserBinding);
    if (!safeEqualBase64Url(receivedBindingHash, expectedBindingHash)) {
      return null;
    }

    return userId;
  }

  /** Intercambia el code, persiste la conexión y retorna sólo datos seguros. */
  async completeAuthorization(
    userId: string,
    code: string,
  ): Promise<TiendanubeOAuthResult> {
    this.requireAppUserId(userId);

    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const response = await this.apiService.postOAuthToken<unknown>({
      client_id: this.getRequiredConfig('TIENDANUBE_CLIENT_ID'),
      client_secret: this.getRequiredConfig('TIENDANUBE_CLIENT_SECRET'),
      grant_type: 'authorization_code',
      code: normalizedCode,
    });
    const tokens = parseOAuthTokenResponse(response);
    const storeId = String(tokens.user_id);

    await this.connectionRepository.saveConnection({
      userId,
      storeId,
      accessToken: tokens.access_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });

    return {
      storeId,
      scope: tokens.scope,
    };
  }

  private createState(
    userId: string,
    nonce: string,
    timestamp: string,
    bindingHash: string,
  ): string {
    const payload = `${userId}.${nonce}.${timestamp}.${bindingHash}`;
    return `${payload}.${this.signState(payload)}`;
  }

  private signState(payload: string): string {
    const stateKey = createHmac(
      'sha256',
      this.getRequiredConfig('TIENDANUBE_CLIENT_SECRET'),
    )
      .update(STATE_KEY_CONTEXT)
      .digest();

    return createHmac('sha256', stateKey).update(payload).digest('base64url');
  }

  private hashBrowserBinding(browserBinding: string): string {
    return createHash('sha256').update(browserBinding).digest('base64url');
  }

  private getRedirectUri(): URL {
    const redirectUri = this.getRequiredConfig('TIENDANUBE_REDIRECT_URI');

    try {
      const parsedUrl = new URL(redirectUri);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Unsupported redirect protocol');
      }
      return parsedUrl;
    } catch {
      throw new ServiceUnavailableException(
        'La integración con Tiendanube no está configurada correctamente',
      );
    }
  }

  private requireAppUserId(userId: string): void {
    if (!APP_USER_ID_PATTERN.test(userId)) {
      throw new BadRequestException('Usuario de la aplicación inválido');
    }
  }

  private getRequiredConfig(
    key: Parameters<typeof getRequiredTiendanubeConfig>[1],
  ): string {
    return getRequiredTiendanubeConfig(this.configService, key);
  }
}

function parseOAuthTokenResponse(value: unknown): TiendanubeOAuthTokenResponse {
  if (
    !isJsonObject(value) ||
    !isNonEmptyString(value.access_token) ||
    !isNonEmptyString(value.token_type) ||
    value.token_type.toLowerCase() !== 'bearer' ||
    typeof value.scope !== 'string'
  ) {
    throw new BadGatewayException(
      'Tiendanube devolvió una respuesta OAuth inválida',
    );
  }

  const storeId = normalizeStoreId(value.user_id);
  if (storeId === null) {
    throw new BadGatewayException(
      'Tiendanube devolvió una respuesta OAuth inválida',
    );
  }

  return {
    access_token: value.access_token.trim(),
    token_type: 'bearer',
    scope: value.scope.trim(),
    user_id: storeId,
  };
}

function normalizeStoreId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return value.trim();
  }

  return null;
}

function safeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'ascii');
  const rightBuffer = Buffer.from(right, 'ascii');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
