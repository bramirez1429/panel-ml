import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  classifyProviderResponse,
  classifySyncError,
} from './publication-sync-error-classifier';

describe('publication sync error classifier', () => {
  it.each([
    [new BadRequestException({ code: 'validation_error' }), 'VALIDATION_ERROR'],
    [new UnauthorizedException(), 'AUTH_ERROR'],
    [new HttpException('rate limit', 429), 'RATE_LIMIT'],
    [new HttpException('provider down', 503), 'PROVIDER_TEMPORARY_ERROR'],
  ])('clasifica errores conocidos', (error, expected) => {
    expect(classifySyncError(error).type).toBe(expected);
  });

  it('clasifica esquema inesperado y código desconocido como posible cambio', () => {
    expect(
      classifySyncError(
        new BadGatewayException('Respuesta con estructura inesperada'),
      ).type,
    ).toBe('POSSIBLE_API_CHANGE');
    expect(
      classifyProviderResponse(400, {
        code: 'brand_new_provider_code',
        message: 'Unknown response',
      }).type,
    ).toBe('POSSIBLE_API_CHANGE');
  });

  it('elimina tokens del mensaje persistible', () => {
    const result = classifySyncError(
      new Error('access_token=secret Bearer abc.def'),
    );
    expect(result.message).not.toContain('secret');
    expect(result.message).not.toContain('abc.def');
  });
});
