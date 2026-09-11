import { BadRequestException, HttpException } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { throwMercadolibreApiError } from '../../shared/mercadolibre-api-error.helpers';
import { VariationDeletionService } from './variation-deletion.service';

describe('VariationDeletionService', () => {
  const getValidAccessToken = jest.fn();
  const deleteRequest = jest.fn();
  const tokenService = {
    getValidAccessToken,
  } as unknown as MercadolibreTokenService;
  const apiService = {
    delete: deleteRequest,
  } as unknown as MercadolibreApiService;
  const service = new VariationDeletionService(tokenService, apiService);

  beforeEach(() => {
    jest.clearAllMocks();
    getValidAccessToken.mockResolvedValue('private-token');
  });

  it('intenta el DELETE real sin consultar ni modificar previamente el item', async () => {
    deleteRequest.mockResolvedValue({ id: 'MLA123' });

    await expect(
      service.deleteVariation('user-1', 'MLA123', '456'),
    ).resolves.toEqual({
      success: true,
      itemId: 'MLA123',
      variationId: '456',
    });
    expect(deleteRequest).toHaveBeenCalledWith(
      '/items/MLA123/variations/456',
      'private-token',
      'variationDelete',
    );
  });

  it('no bloquea localmente publicaciones closed o con ventas', async () => {
    deleteRequest.mockResolvedValue(undefined);

    await service.deleteVariation('user-1', 'MLA123', '456');

    expect(deleteRequest).toHaveBeenCalledTimes(1);
  });

  it('propaga el error normalizado de Mercado Libre', async () => {
    const providerError = new HttpException(
      {
        success: false,
        code: 'MELI_VARIATION_DELETE_FAILED',
        message: 'variation has sales',
        error: 'validation_error',
        cause: [{ code: 'item.variation.invalid' }],
        meliStatus: 400,
      },
      400,
    );
    deleteRequest.mockRejectedValue(providerError);

    await expect(
      service.deleteVariation('user-1', 'MLA123', '456'),
    ).rejects.toBe(providerError);
  });

  it.each([
    ['MLA inv\u00e1lido', 'Crema / 38', '456'],
    ['variationId descriptivo', 'MLA123', 'Crema / 38'],
    ['SKU', 'MLA123', 'SKU-38'],
  ])(
    'rechaza %s antes de obtener el token',
    async (_case, itemId, variationId) => {
      await expect(
        service.deleteVariation('user-1', itemId, variationId),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(getValidAccessToken).not.toHaveBeenCalled();
      expect(deleteRequest).not.toHaveBeenCalled();
    },
  );
});

describe('error de eliminaci\u00f3n de variaci\u00f3n', () => {
  it('conserva status, message, error y cause sin exponer credenciales', () => {
    expect.hasAssertions();
    try {
      throwMercadolibreApiError(409, 'variationDelete', {
        message: 'variation cannot be deleted',
        error: 'conflict',
        cause: [{ code: 'variation_has_sales' }],
        access_token: 'must-not-leak',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(409);
      expect(exception.getResponse()).toEqual({
        success: false,
        code: 'MELI_VARIATION_DELETE_FAILED',
        message: 'variation cannot be deleted',
        error: 'conflict',
        cause: [{ code: 'variation_has_sales' }],
        meliStatus: 409,
      });
    }
  });
});
