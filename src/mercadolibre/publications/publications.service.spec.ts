import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../database/repositories/mercadolibre-products.repository';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { PublicationsService } from './publications.service';
import { PublicationManagementReaderService } from './mutations/publication-management-reader.service';
import { PublicationLiveContentService } from './mutations/publication-live-content.service';

const PRODUCT_ID = '123e4567-e89b-42d3-a456-426614174000';
const connection = { seller_id: 123 };

describe('PublicationsService', () => {
  const getStoredConnection = jest.fn();
  const findPage = jest.fn();
  const findById = jest.fn();
  const findByProductId = jest.fn();
  const findAttributesByProductIds = jest.fn();
  const hydrate = jest.fn();
  const readContent = jest.fn();
  let service: PublicationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    getStoredConnection.mockResolvedValue(connection);
    readContent.mockResolvedValue(null);
    service = new PublicationsService(
      { getStoredConnection } as unknown as MercadolibreTokenService,
      { findPage, findById } as unknown as MercadolibreProductsRepository,
      {
        findByProductId,
        findAttributesByProductIds,
      } as unknown as MercadolibreChildrenRepository,
      { hydrate } as unknown as PublicationManagementReaderService,
      { read: readContent } as unknown as PublicationLiveContentService,
    );
  });

  it('lista desde Supabase con count y paginación', async () => {
    const products = [
      {
        id: PRODUCT_ID,
        model: 'SHARED',
        children_count: 0,
        shared_variations: [
          {
            attributes: [
              { id: 'FILTRABLE_SIZE', valueName: '38 años' },
              { id: 'SIZE', valueName: '40' },
            ],
          },
        ],
      },
    ];
    findPage.mockResolvedValue({ products, total: 21 });

    await expect(service.list(2, 20)).resolves.toEqual({
      paging: { page: 2, limit: 20, total: 21, totalPages: 2 },
      count: 1,
      publications: [
        {
          id: PRODUCT_ID,
          model: 'SHARED',
          children_count: 0,
          sizes: ['40'],
          variants_count: 1,
        },
      ],
    });
    expect(findPage).toHaveBeenCalledWith(123, 2, 20);
    expect(findAttributesByProductIds).not.toHaveBeenCalled();
  });

  it('agrega talles únicos de hijos VARIANT_PRICING', async () => {
    const product = {
      id: PRODUCT_ID,
      model: 'VARIANT_PRICING',
      children_count: 2,
      shared_variations: [],
    };
    findPage.mockResolvedValue({ products: [product], total: 1 });
    findAttributesByProductIds.mockResolvedValue([
      {
        product_id: PRODUCT_ID,
        attributes: [
          { id: 'FILTRABLE_SIZE', valueName: '4 años' },
          { id: 'SIZE', valueName: '40' },
        ],
      },
      {
        product_id: PRODUCT_ID,
        attributes: [{ id: 'SIZE', valueName: '38' }],
      },
    ]);

    const response = await service.list(1, 20);

    expect(response.publications).toEqual([
      {
        id: PRODUCT_ID,
        model: 'VARIANT_PRICING',
        children_count: 2,
        sizes: ['38', '40'],
        variants_count: 2,
      },
    ]);
    expect(findAttributesByProductIds).toHaveBeenCalledWith([PRODUCT_ID]);
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
    const management = { pictures: [] };
    findById.mockResolvedValue(product);
    hydrate.mockResolvedValue(management);

    await expect(service.findOne(PRODUCT_ID)).resolves.toEqual({
      product,
      management,
    });
    expect(findByProductId).not.toHaveBeenCalled();
  });

  it('devuelve los hijos de VARIANT_PRICING', async () => {
    const product = { id: PRODUCT_ID, model: 'VARIANT_PRICING' };
    const children = [{ item_id: 'MLA123' }];
    findById.mockResolvedValue(product);
    findByProductId.mockResolvedValue(children);
    hydrate.mockResolvedValue({ pictures: [] });

    await expect(service.findOne(PRODUCT_ID)).resolves.toEqual({
      product,
      children,
      management: { pictures: [] },
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
