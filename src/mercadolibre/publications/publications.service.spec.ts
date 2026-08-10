import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { PublicationsService } from './publications.service';

const PRODUCT_ID = '123e4567-e89b-42d3-a456-426614174000';
const connection = { seller_id: 123 };

describe('PublicationsService', () => {
  const getStoredConnection = jest.fn();
  const findPage = jest.fn();
  const findById = jest.fn();
  const findByProductId = jest.fn();
  let service: PublicationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    getStoredConnection.mockResolvedValue(connection);
    service = new PublicationsService(
      { getStoredConnection } as unknown as MercadolibreTokenService,
      { findPage, findById } as unknown as MercadolibreProductsRepository,
      { findByProductId } as unknown as MercadolibreChildrenRepository,
    );
  });

  it('lista desde Supabase con count y paginación', async () => {
    const products = [{ id: PRODUCT_ID, model: 'SHARED' }];
    findPage.mockResolvedValue({ products, total: 21 });

    await expect(service.list(2, 20)).resolves.toEqual({
      paging: { page: 2, limit: 20, total: 21, totalPages: 2 },
      count: 1,
      publications: products,
    });
    expect(findPage).toHaveBeenCalledWith(123, 2, 20);
  });

  it('rechaza paginación inválida antes de consultar Supabase', async () => {
    await expect(service.list(0, 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.list(1, 101)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(getStoredConnection).not.toHaveBeenCalled();
  });

  it('devuelve SHARED sin consultar hijos', async () => {
    const product = { id: PRODUCT_ID, model: 'SHARED' };
    findById.mockResolvedValue(product);

    await expect(service.findOne(PRODUCT_ID)).resolves.toEqual({ product });
    expect(findByProductId).not.toHaveBeenCalled();
  });

  it('devuelve los hijos de VARIANT_PRICING', async () => {
    const product = { id: PRODUCT_ID, model: 'VARIANT_PRICING' };
    const children = [{ item_id: 'MLA123' }];
    findById.mockResolvedValue(product);
    findByProductId.mockResolvedValue(children);

    await expect(service.findOne(PRODUCT_ID)).resolves.toEqual({
      product,
      children,
    });
  });

  it('valida UUID y devuelve 404 cuando no existe', async () => {
    await expect(service.findOne('MLA123')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    findById.mockResolvedValue(null);
    await expect(service.findOne(PRODUCT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
