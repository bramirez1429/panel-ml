import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationManagementTargetService } from './publication-management-target.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationManagementTargetService', () => {
  const getStoredConnection = jest.fn();
  const getValidAccessToken = jest.fn();
  const findById = jest.fn();
  const findByProductId = jest.fn();
  const get = jest.fn();
  let service: PublicationManagementTargetService;

  beforeEach(() => {
    jest.resetAllMocks();
    getStoredConnection.mockResolvedValue({ seller_id: 123 });
    getValidAccessToken.mockResolvedValue('token');
    findById.mockResolvedValue({
      id: PRODUCT_ID,
      model: 'VARIANT_PRICING',
      parent_item_id: null,
    });
    findByProductId.mockResolvedValue([
      { item_id: 'MLA200', user_product_id: 'MLAU300' },
    ]);
    service = new PublicationManagementTargetService(
      {
        getStoredConnection,
        getValidAccessToken,
      } as unknown as MercadolibreTokenService,
      { findById } as unknown as MercadolibreProductsRepository,
      { findByProductId } as unknown as MercadolibreChildrenRepository,
      { get } as unknown as MercadolibreApiService,
    );
  });

  it('filtra producto por seller y rechaza un item ajeno antes de consultar ML', async () => {
    await expect(service.resolve(PRODUCT_ID, 'MLA999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findById).toHaveBeenCalledWith(123, PRODUCT_ID);
    expect(getValidAccessToken).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('valida seller y user_product_id vivos', async () => {
    const context = await service.resolve(PRODUCT_ID, 'MLA200');
    get.mockResolvedValueOnce({
      id: 'MLA200',
      seller_id: 999,
      user_product_id: 'MLAU300',
    });
    await expect(service.getOwnedItem(context, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    get.mockResolvedValueOnce({
      id: 'MLA200',
      seller_id: 123,
      user_product_id: 'MLAU999',
    });
    await expect(service.getOwnedItem(context, true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(get).toHaveBeenCalledWith(
      '/items/MLA200?include_attributes=all',
      'token',
    );
  });
});
