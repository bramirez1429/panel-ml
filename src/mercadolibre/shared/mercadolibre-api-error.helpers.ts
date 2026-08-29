import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { MercadoLibreRequestKind } from './mercadolibre.types';
import { isJsonObject, isNonEmptyString } from './mercadolibre.types';

const PRIVATE_FIELDS = new Set([
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
]);

export function throwMercadolibreApiError(
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
  if (kind === 'description' && status === 404) {
    throw new NotFoundException(
      'Mercado Libre no encontró la descripción solicitada',
    );
  }
  if (kind === 'promotion') throwPromotionApiError(status, safeData);
  if (status === 400) {
    throw new BadRequestException(
      isJsonObject(safeData) ? safeData : 'Mercado Libre rechazó la solicitud',
    );
  }
  if (status === 401)
    throw new UnauthorizedException('Acceso inválido o vencido');
  if (status === 403) throw new ForbiddenException('Permisos insuficientes');
  if (status === 429)
    throw new ServiceUnavailableException('Demasiadas solicitudes');
  throw new BadGatewayException('Mercado Libre no completó la solicitud');
}

function throwPromotionApiError(status: number, safeData: unknown): void {
  if (status === 404)
    throw new NotFoundException('La promoción o publicación ya no existe');
  if (status === 400 || status === 409) {
    const mercadoLibreMessage = providerText(safeData, 'message', 500);
    const mercadoLibreError = providerText(safeData, 'error', 100);
    throw new BadRequestException({
      message: 'La promoción cambió o ya no es aplicable',
      ...(mercadoLibreMessage ? { mercadoLibreMessage } : {}),
      ...(mercadoLibreError ? { mercadoLibreError } : {}),
    });
  }
  if (status === 429)
    throw new HttpException('Mercado Libre limitó las solicitudes', 429);
  if (status >= 500)
    throw new ServiceUnavailableException(
      'Mercado Libre no está disponible temporalmente',
    );
}

function providerText(
  safeData: unknown,
  field: 'message' | 'error',
  maximumLength: number,
): string | undefined {
  if (!isJsonObject(safeData)) return undefined;
  const value = safeData[field];
  return isNonEmptyString(value)
    ? value.trim().slice(0, maximumLength)
    : undefined;
}

export function sanitizeMercadoLibreData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitizeMercadoLibreData) as T;
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
