import { HttpException, UnprocessableEntityException } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { throwMercadolibreApiError } from '../../shared/mercadolibre-api-error.helpers';
import { ItemsService } from './items.service';
import { VariationDeletionService } from './variation-deletion.service';

describe('VariationDeletionService', () => {
  const getValidAccessToken = jest.fn();
  const deleteRequest = jest.fn();
  const getOne = jest.fn();
  const tokenService = {
    getValidAccessToken,
  } as unknown as MercadolibreTokenService;
  const apiService = {
    delete: deleteRequest,
  } as unknown as MercadolibreApiService;
  const itemsService = {
    getOne,
  } as unknown as ItemsService;
  const service = new VariationDeletionService(
    tokenService,
    apiService,
    itemsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getValidAccessToken.mockResolvedValue('private-token');
  });

  it('elimina realmente una variaci\u00f3n LEGACY aunque tenga stock 0', async () => {
    getOne.mockResolvedValue({
      id: 'MLA123',
      variations: [{ id: 456, available_quantity: 0 }],
    });
    deleteRequest.mockResolvedValue({ id: 'MLA123' });

    await expect(
      service.deleteVariation('user-1', 'MLA123', '456'),
    ).resolves.toEqual({
      success: true,
      model: 'LEGACY',
      itemId: 'MLA123',
      variationId: '456',
    });
    expect(deleteRequest).toHaveBeenCalledWith(
      '/items/MLA123/variations/456',
      'private-token',
      'variationDelete',
    );
  });

  it('no ejecuta el DELETE cl\u00e1sico para USER_PRODUCT', async () => {
    getOne.mockResolvedValue({
      id: 'MLA123',
      family_id: 10,
      user_product_id: 'MLAU456',
      variations: [],
    });

    await expect(
      service.deleteVariation('user-1', 'MLA123', '456'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(deleteRequest).not.toHaveBeenCalled();
  });

  it('propaga el error normalizado de Mercado Libre', async () => {
    const providerError = new HttpException(
      {
        success: false,
        code: 'MERCADOLIBRE_VARIATION_DELETE_FAILED',
        message: 'variation has sales',
        error: 'validation_error',
        cause: [{ code: 'item.variation.invalid' }],
        mercadoLibreStatus: 400,
      },
      400,
    );
    getOne.mockResolvedValue({
      id: 'MLA123',
      variations: [{ id: 456 }],
    });
    deleteRequest.mockRejectedValue(providerError);

    await expect(
      service.deleteVariation('user-1', 'MLA123', '456'),
    ).rejects.toBe(providerError);
  });
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
        code: 'MERCADOLIBRE_VARIATION_DELETE_FAILED',
        message: 'variation cannot be deleted',
        error: 'conflict',
        cause: [{ code: 'variation_has_sales' }],
        mercadoLibreStatus: 409,
      });
    }
  });
});
