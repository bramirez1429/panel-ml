import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const MERCADOLIBRE_API_URL = 'https://api.mercadolibre.com';
export const MERCADOLIBRE_AUTHORIZATION_URL =
  'https://auth.mercadolibre.com.ar/authorization';
export const MERCADOLIBRE_REQUEST_TIMEOUT_MS = 10_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type MercadoLibreConfigKey =
  'ML_CLIENT_ID' | 'ML_CLIENT_SECRET' | 'ML_REDIRECT_URI' | 'ML_STATE_SECRET';

/** Lee una variable obligatoria sin mostrar su contenido. */
export function getRequiredMercadoLibreConfig(
  configService: ConfigService,
  key: MercadoLibreConfigKey,
): string {
  const value = configService.get<string>(key)?.trim();
  if (!value) {
    throw new ServiceUnavailableException(
      'La integración con Mercado Libre no está configurada correctamente',
    );
  }
  return value;
}
