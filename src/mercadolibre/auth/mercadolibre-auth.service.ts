import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
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
import {
  type MercadoLibreConnection,
  SupabaseService,
} from '../../database/supabase.service';
import {
  getRequiredMercadoLibreConfig,
  MERCADOLIBRE_AUTHORIZATION_URL,
  OAUTH_STATE_TTL_MS,
} from '../shared/mercadolibre.config';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
  isPositiveInteger,
  MercadoLibreSeller,
  MercadoLibreTokens,
  parseMercadoLibreTokens,
} from '../shared/mercadolibre.types';

const APP_USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_TIMESTAMP_PATTERN = /^\d{13}$/;
const STATE_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_BROWSER_BINDING_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_BROWSER_COOKIE_PREFIX = 'mercadolibre_oauth_binding_';

export type MercadoLibreAuthorizationRequest = {
  url: string;
  cookieName: string;
  cookiePath: string;
  browserBinding: string;
  secureCookie: boolean;
};

@Injectable()
export class MercadolibreAuthService {
  /** Recibe las dependencias del flujo OAuth. */
  constructor(
    private readonly configService: ConfigService,
    private readonly apiService: MercadolibreApiService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /** Crea la URL para autorizar la cuenta. */
  async createAuthorizationRequest(
    userId: string,
    refreshSessionId: string,
  ): Promise<MercadoLibreAuthorizationRequest> {
    this.requireAppUserId(userId);
    this.requireAppUserId(refreshSessionId);
    const browserBinding = randomBytes(32).toString('base64url');
    const bindingHash = this.hashBrowserBinding(browserBinding);
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now();
    const redirectUri = this.getRedirectUri();
    const state = this.createState(
      userId,
      nonce,
      timestamp.toString(),
      bindingHash,
    );
    const stored =
      await this.supabaseService.createMercadoLibreOAuthTransaction({
        stateHash: this.hashState(state),
        userId,
        refreshSessionId,
        browserBindingHash: bindingHash,
        expiresAt: new Date(timestamp + OAUTH_STATE_TTL_MS).toISOString(),
      });
    if (!stored) {
      throw new UnauthorizedException(
        'La sesión que inició Mercado Libre ya no está vigente',
      );
    }

    const authorizationUrl = new URL(MERCADOLIBRE_AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      redirect_uri: redirectUri,
      state,
    }).toString();
    return {
      url: authorizationUrl.toString(),
      cookieName: `${OAUTH_BROWSER_COOKIE_PREFIX}${nonce}`,
      cookiePath: new URL(redirectUri).pathname || '/',
      browserBinding,
      secureCookie: new URL(redirectUri).protocol === 'https:',
    };
  }

  /** Obtiene el nombre de cookie aislado de una transacción bien formada. */
  getAuthorizationCookieName(state: string): string | null {
    const parts = state.split('.');
    if (parts.length !== 5 || !STATE_NONCE_PATTERN.test(parts[1])) return null;
    return `${OAUTH_BROWSER_COOKIE_PREFIX}${parts[1]}`;
  }

  /** Devuelve el path exacto donde Mercado Libre invoca el callback. */
  getCallbackCookiePath(): string {
    return new URL(this.getRedirectUri()).pathname || '/';
  }

  /** Valida y consume el state, recuperando al usuario que inició el flujo. */
  async verifyState(
    state: string,
    browserBinding?: string,
  ): Promise<string | null> {
    if (
      typeof state !== 'string' ||
      !browserBinding ||
      !OAUTH_BROWSER_BINDING_PATTERN.test(browserBinding)
    ) {
      return null;
    }

    const parts = state.split('.');
    if (parts.length !== 5) return null;

    const [
      userId,
      nonce,
      timestampValue,
      receivedBindingHash,
      receivedSignature,
    ] = parts;
    if (
      !APP_USER_ID_PATTERN.test(userId) ||
      !STATE_NONCE_PATTERN.test(nonce) ||
      !STATE_TIMESTAMP_PATTERN.test(timestampValue) ||
      !STATE_SIGNATURE_PATTERN.test(receivedBindingHash) ||
      !STATE_SIGNATURE_PATTERN.test(receivedSignature)
    ) {
      return null;
    }

    const timestamp = Number(timestampValue);
    const age = Date.now() - timestamp;
    if (
      !Number.isSafeInteger(timestamp) ||
      age < 0 ||
      age > OAUTH_STATE_TTL_MS
    ) {
      return null;
    }

    const payload = `${userId}.${nonce}.${timestampValue}.${receivedBindingHash}`;
    const expectedSignature = this.signState(payload);
    const receivedBuffer = Buffer.from(receivedSignature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
    const signatureIsValid =
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer);
    if (!signatureIsValid) return null;

    const expectedBindingHash = this.hashBrowserBinding(browserBinding);
    const bindingBuffer = Buffer.from(receivedBindingHash, 'base64url');
    const expectedBindingBuffer = Buffer.from(expectedBindingHash, 'base64url');
    const browserIsValid =
      bindingBuffer.length === expectedBindingBuffer.length &&
      timingSafeEqual(bindingBuffer, expectedBindingBuffer);
    if (!browserIsValid) return null;

    const consumed =
      await this.supabaseService.consumeMercadoLibreOAuthTransaction({
        stateHash: this.hashState(state),
        userId,
        browserBindingHash: expectedBindingHash,
      });
    return consumed ? userId : null;
  }

  /** Intercambia el código OAuth por tokens. */
  async exchangeCode(code: string): Promise<MercadoLibreTokens> {
    if (!isNonEmptyString(code)) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const response = await this.apiService.postForm<unknown>(
      '/oauth/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.getRequiredConfig('ML_CLIENT_ID'),
        client_secret: this.getRequiredConfig('ML_CLIENT_SECRET'),
        code,
        redirect_uri: this.getRedirectUri(),
      }),
      'tokenExchange',
    );
    return parseMercadoLibreTokens(response);
  }

  /** Obtiene los datos públicos básicos del usuario conectado. */
  async getCurrentUser(accessToken: string): Promise<MercadoLibreSeller> {
    const data = await this.apiService.get<unknown>('/users/me', accessToken);
    if (
      !isJsonObject(data) ||
      !isPositiveInteger(data.id) ||
      !isNonEmptyString(data.nickname)
    ) {
      throw new BadGatewayException('Datos de vendedor inválidos');
    }
    return { id: data.id, nickname: data.nickname };
  }

  /** Guarda los tokens y calcula su vencimiento. */
  async saveTokens(
    userId: string,
    seller: MercadoLibreSeller,
    tokens: MercadoLibreTokens,
  ): Promise<void> {
    this.requireAppUserId(userId);
    if (tokens.user_id !== seller.id) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una identidad inconsistente',
      );
    }

    const now = new Date();
    await this.supabaseService.saveConnection({
      user_id: userId,
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

  /** Guarda un refresh con compare-and-swap para no pisar reconexiones. */
  async saveRefreshedTokens(
    userId: string,
    connection: MercadoLibreConnection,
    tokens: MercadoLibreTokens,
  ): Promise<void> {
    this.requireAppUserId(userId);
    if (
      connection.user_id !== userId ||
      tokens.user_id !== connection.seller_id
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvi\u00f3 una identidad inconsistente',
      );
    }

    const now = new Date();
    const updated = await this.supabaseService.saveRefreshedConnection(
      {
        ...connection,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(
          now.getTime() + tokens.expires_in * 1000,
        ).toISOString(),
        updated_at: now.toISOString(),
      },
      connection.updated_at,
    );
    if (!updated) {
      throw new ConflictException(
        'La conexi\u00f3n de Mercado Libre cambi\u00f3 durante la renovaci\u00f3n',
      );
    }
  }

  /** Crea un state firmado por diez minutos. */
  private createState(
    userId: string,
    nonce: string,
    timestamp: string,
    bindingHash: string,
  ): string {
    const payload = `${userId}.${nonce}.${timestamp}.${bindingHash}`;
    return `${payload}.${this.signState(payload)}`;
  }

  /** Resume el secreto del navegador antes de incluirlo en el state. */
  private hashBrowserBinding(browserBinding: string): string {
    return createHash('sha256').update(browserBinding).digest('base64url');
  }

  /** Evita guardar el state OAuth en texto claro. */
  private hashState(state: string): string {
    return createHash('sha256').update(state).digest('hex');
  }

  /** Rechaza identificadores que no pueden pertenecer a users.id. */
  private requireAppUserId(userId: string): void {
    if (!APP_USER_ID_PATTERN.test(userId)) {
      throw new BadRequestException('Usuario de la aplicación inválido');
    }
  }

  /** Firma el contenido del state. */
  private signState(payload: string): string {
    return createHmac('sha256', this.getStateSecret())
      .update(payload)
      .digest('base64url');
  }

  /** Lee y valida el secreto del state. */
  private getStateSecret(): string {
    const secret = this.getRequiredConfig('ML_STATE_SECRET');
    if (Buffer.byteLength(secret, 'utf8') < 32) {
      throw new ServiceUnavailableException(
        'La integración con Mercado Libre no está configurada correctamente',
      );
    }
    return secret;
  }

  /** Lee y valida la URL exacta del callback. */
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
  private getRequiredConfig(
    key: Parameters<typeof getRequiredMercadoLibreConfig>[1],
  ): string {
    return getRequiredMercadoLibreConfig(this.configService, key);
  }
}
