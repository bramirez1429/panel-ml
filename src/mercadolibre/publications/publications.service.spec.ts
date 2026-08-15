import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { PublicationsService } from './publications.service';

const PRODUCT_ID = '123e4567-e89b-42d3-a456-426614174000';

const connection = {
  seller_id: 123,
  access_token: 'token-test',
};

describe('PublicationsService', () => {
  const getStoredConnection = jest.fn();

  const findPage = jest.fn();
  const findById = jest.fn();
  const updateProductPrice = jest.fn();

  const findByProductId = jest.fn();
  const updateChildPrice = jest.fn();

  const apiPut = jest.fn();

  let service: PublicationsService;

  beforeEach(() => {
    jest.clearAllMocks();

    getStoredConnection.mockResolvedValue(connection);
    apiPut.mockResolvedValue({});

    service = new PublicationsService(
      {
        getStoredConnection,
      } as unknown as MercadolibreTokenService,

      {
        findPage,
        findById,
        updatePrice: updateProductPrice,
      } as unknown as MercadolibreProductsRepository,

      {
        findByProductId,
        updatePrice: updateChildPrice,
      } as unknown as MercadolibreChildrenRepository,

      {
        put: apiPut,
      } as unknown as MercadolibreApiService,
    );
  });

  it('lista desde Supabase con count y paginación', async () => {
    const products = [
      {
        id: PRODUCT_ID,
        model: 'SHARED',
      },
    ];

    findPage.mockResolvedValue({
      products,
      total: 21,
    });

    await expect(service.list(2, 20)).resolves.toEqual({
      paging: {
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
      },
      count: 1,
      publications: products,
    });

    expect(findPage).toHaveBeenCalledWith(123, 2, 20);
  });

  it('rechaza paginación inválida antes de consultar Supabase', async () => {
    await expect(
      service.list(0, 20),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.list(1, 101),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(getStoredConnection).not.toHaveBeenCalled();
  });

  it('devuelve SHARED sin consultar hijos', async () => {
    const product = {
      id: PRODUCT_ID,
      model: 'SHARED',
    };

    findById.mockResolvedValue(product);

    await expect(
      service.findOne(PRODUCT_ID),
    ).resolves.toEqual({
      product,
    });

    expect(findByProductId).not.toHaveBeenCalled();
  });

  it('devuelve los hijos de VARIANT_PRICING', async () => {
    const product = {
      id: PRODUCT_ID,
      model: 'VARIANT_PRICING',
    };

    const children = [
      {
        item_id: 'MLA123',
      },
    ];

    findById.mockResolvedValue(product);
    findByProductId.mockResolvedValue(children);

    await expect(
      service.findOne(PRODUCT_ID),
    ).resolves.toEqual({
      product,
      children,
    });
  });

  it('valida UUID y devuelve 404 cuando no existe', async () => {
    await expect(
      service.findOne('MLA123'),
    ).rejects.toBeInstanceOf(BadRequestException);

    findById.mockResolvedValue(null);

    await expect(
      service.findOne(PRODUCT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('actualiza precio SHARED en Mercado Libre y Supabase', async () => {
    findById.mockResolvedValue({
      id: PRODUCT_ID,
      model: 'SHARED',
      parent_item_id: 'MLA111111111',
    });

    await service.updatePrice(PRODUCT_ID, 45000);

    expect(apiPut).toHaveBeenCalledWith(
      '/items/MLA111111111',
      { price: 45000 },
      'token-test',
    );

    expect(updateProductPrice).toHaveBeenCalledWith(
      PRODUCT_ID,
      45000,
    );
  });

  it('actualiza precio VARIANT_PRICING en Mercado Libre y Supabase', async () => {
    findById.mockResolvedValue({
      id: PRODUCT_ID,
      model: 'VARIANT_PRICING',
    });

    findByProductId.mockResolvedValue([
      {
        item_id: 'MLA222222222',
      },
    ]);

    await service.updatePrice(
      PRODUCT_ID,
      50000,
      'MLA222222222',
    );

    expect(apiPut).toHaveBeenCalledWith(
      '/items/MLA222222222',
      { price: 50000 },
      'token-test',
    );

    expect(updateChildPrice).toHaveBeenCalledWith(
      'MLA222222222',
      50000,
    );
  });

  it('rechaza precio menor o igual a cero', async () => {
    await expect(
      service.updatePrice(PRODUCT_ID, 0),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiPut).not.toHaveBeenCalled();
  });

  it('no actualiza Supabase si Mercado Libre falla', async () => {
    findById.mockResolvedValue({
      id: PRODUCT_ID,
      model: 'SHARED',
      parent_item_id: 'MLA111111111',
    });

    apiPut.mockRejectedValue(
      new Error('Mercado Libre falló'),
    );

    await expect(
      service.updatePrice(PRODUCT_ID, 45000),
    ).rejects.toThrow('Mercado Libre falló');

    expect(updateProductPrice).not.toHaveBeenCalled();
    expect(updateChildPrice).not.toHaveBeenCalled();
  });
});