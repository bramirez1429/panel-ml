import { BadGatewayException } from '@nestjs/common';

export type JsonObject = Record<string, unknown>;
export type MercadoLibreRequestKind =
  'tokenExchange' | 'scroll' | 'description';

export type MercadoLibreTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};

export type MercadoLibreSeller = {
  id: number;
  nickname: string;
};

/** Indica si un valor es un objeto JSON. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Indica si un valor es texto no vacío. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Indica si un valor es un entero positivo. */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Valida los tokens recibidos de Mercado Libre. */
export function parseMercadoLibreTokens(response: unknown): MercadoLibreTokens {
  if (
    !isJsonObject(response) ||
    !isNonEmptyString(response.access_token) ||
    !isNonEmptyString(response.refresh_token) ||
    !isPositiveInteger(response.expires_in) ||
    !isPositiveInteger(response.user_id)
  ) {
    throw new BadGatewayException('Mercado Libre devolvió tokens inválidos');
  }

  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_in: response.expires_in,
    user_id: response.user_id,
  };
}
