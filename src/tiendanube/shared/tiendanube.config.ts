import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const TIENDANUBE_API_URL = 'https://api.tiendanube.com';
export const TIENDANUBE_API_VERSION = '2025-03';
export const TIENDANUBE_REQUEST_TIMEOUT_MS = 10_000;

export type TiendanubeEnvironment = {
  TIENDANUBE_CLIENT_ID: string;
  TIENDANUBE_CLIENT_SECRET: string;
  TIENDANUBE_REDIRECT_URI: string;
  TIENDANUBE_USER_AGENT: string;
};

export type TiendanubeConfigKey = keyof TiendanubeEnvironment;

/** Lee configuración obligatoria sin exponer su nombre ni contenido. */
export function getRequiredTiendanubeConfig(
  configService: ConfigService<TiendanubeEnvironment>,
  key: TiendanubeConfigKey,
): string {
  const value = configService.get(key, { infer: true })?.trim();

  if (!value) {
    throw new ServiceUnavailableException(
      'La integración con Tiendanube no está configurada correctamente',
    );
  }

  return value;
}
