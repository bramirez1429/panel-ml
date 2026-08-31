import { HttpException } from '@nestjs/common';

import {
  normalizedPromotionException,
  promotionProviderMessage,
  promotionProviderStatus,
} from './promotion-error-mapper';

describe('promotion error mapper', () => {
  it('extrae mensaje por prioridad y status original', () => {
    const error = new HttpException(
      {
        message: 'wrapper',
        mercadoLibreMessage: 'provider detail',
        mercadoLibreStatus: 500,
        cause: [{ message: 'cause detail' }],
      },
      503,
    );

    expect(promotionProviderMessage(error)).toBe('provider detail');
    expect(promotionProviderStatus(error)).toBe(500);
  });

  it('usa cause.message o cause.error_message si no hay mensaje superior', () => {
    expect(
      promotionProviderMessage(
        new HttpException({ cause: [{ message: 'cause detail' }] }, 500),
      ),
    ).toBe('cause detail');
    expect(
      promotionProviderMessage(
        new HttpException({ cause: [{ error_message: 'error detail' }] }, 500),
      ),
    ).toBe('error detail');
  });

  it('preserva providerMessage al normalizar un fallo de source resolution', () => {
    const normalized = normalizedPromotionException(
      new HttpException(
        {
          mercadoLibreMessage: 'item lookup failed',
          mercadoLibreStatus: 502,
        },
        503,
      ),
      'PROMOTION_PROVIDER_UNAVAILABLE',
    );

    expect(normalized.getResponse()).toMatchObject({
      code: 'PROMOTION_PROVIDER_UNAVAILABLE',
      providerMessage: 'item lookup failed',
      providerStatus: 502,
    });
  });
});
