import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SupabaseService } from '../../database/supabase.service';
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

@Injectable()
export class MercadolibreAuthService {
  /** Recibe las dependencias del flujo OAuth. */
  constructor(
    private readonly configService: ConfigService,
    private readonly apiService: MercadolibreApiService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /** Crea la URL para autorizar la cuenta. */
  createAuthorizationUrl(): string {
    const authorizationUrl = new URL(MERCADOLIBRE_AUTHORIZATION_URL);
    authorizationUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.getRequiredConfig('ML_CLIENT_ID'),
      redirect_uri: this.getRedirectUri(),
      state: this.createState(),
    }).toString();
    return authorizationUrl.toString();
  }

  /** Comprueba que el state sea auténtico y vigente. */
  verifyState(state: string): boolean {
    if (typeof state !== 'string') return false;

    const parts = state.split('.');
    if (parts.length !== 3) return false;

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
    if (
      !Number.isSafeInteger(timestamp) ||
      age < 0 ||
      age > OAUTH_STATE_TTL_MS
    ) {
      return false;
    }

    const expectedSignature = this.signState(`${nonce}.${timestampValue}`);
    const receivedBuffer = Buffer.from(receivedSignature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64url');
    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
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
    seller: MercadoLibreSeller,
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

  /** Crea un state firmado por diez minutos. */
  private createState(): string {
    const nonce = randomBytes(32).toString('base64url');
    const timestamp = Date.now().toString();
    const payload = `${nonce}.${timestamp}`;
    return `${payload}.${this.signState(payload)}`;
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
