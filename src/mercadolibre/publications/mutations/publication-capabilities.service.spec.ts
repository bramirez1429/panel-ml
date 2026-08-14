import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationLiveContentService } from './publication-live-content.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationCapabilitiesService } from './publication-capabilities.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT = {
  id: PRODUCT_ID,
  model: 'SHARED' as const,
  parent_item_id: 'MLA100',
};
const CONTEXT = {
  product: PRODUCT,
  target: {
    productId: PRODUCT_ID,
    model: 'SHARED' as const,
    itemId: 'MLA100',
    userProductId: null,
  },
  sellerId: 123,
  accessToken: 'token',
};

describe('PublicationCapabilitiesService', () => {
  const resolveProduct = jest.fn();
  const resolve = jest.fn();
  const getOwnedItem = jest.fn();
  const apiGet = jest.fn();
  const apiGetOptional = jest.fn();
  const getDescription = jest.fn();
  let service: PublicationCapabilitiesService;

  beforeEach(() => {
    jest.resetAllMocks();
    resolveProduct.mockResolvedValue({
      product: PRODUCT,
      sellerId: 123,
      accessToken: 'token',
    });
    resolve.mockResolvedValue(CONTEXT);
    getOwnedItem.mockResolvedValue({
      id: 'MLA100',
      seller_id: 123,
      category_id: 'MLA1234',
      title: 'Producto',
      status: 'active',
      sub_status: [],
      tags: ['dynamic_standard_price'],
      attributes: [{ id: 'BRAND', value_name: 'Acme' }],
    });
    apiGet.mockImplementation((path: string) => {
      if (path === '/categories/MLA1234/attributes') {
        return Promise.resolve([
          { id: 'BRAND', name: 'Marca', tags: {} },
        ]);
      }
      if (path === '/users/123') {
        return Promise.resolve({ id: 123, tags: [] });
      }
      if (path.includes('/seller-promotions/items/')) {
        return Promise.resolve({
          results: [
            { type: 'PRICE_DISCOUNT', status: 'candidate' },
          ],
        });
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    apiGetOptional.mockImplementation((path: string) => {
      if (path.includes('/seller-promotions/items/')) {
        return Promise.resolve({
          results: [{ type: 'PRICE_DISCOUNT', status: 'candidate' }],
        });
      }
      return Promise.resolve(null);
    });
    getDescription.mockResolvedValue('Descripción');
    service = new PublicationCapabilitiesService(
      {
        resolveProduct,
        resolve,
        getOwnedItem,
      } as unknown as PublicationManagementTargetService,
      { findByProductId: jest.fn() } as unknown as MercadolibreChildrenRepository,
      {
        get: apiGet,
        getOptional: apiGetOptional,
      } as unknown as MercadolibreApiService,
      { getDescription } as unknown as PublicationLiveContentService,
    );
  });

  it('combina restricciones vivas y elegibilidad oficial sin romper el contrato UI', async () => {
    const result = await service.get(PRODUCT_ID, undefined);

    expect(result).toEqual(
      expect.objectContaining({
        canEditPrice: false,
        canEditStock: true,
        canEditSku: true,
        canPause: true,
        canActivate: false,
        canEditPictures: true,
        currentContent: expect.objectContaining({
          title: 'Producto',
          description: 'Descripción',
        }),
        fields: expect.objectContaining({
          title: expect.objectContaining({ editable: true }),
        }),
        promotions: {
          priceDiscountApply: true,
          priceDiscountRemove: false,
        },
      }),
    );
  });
});
