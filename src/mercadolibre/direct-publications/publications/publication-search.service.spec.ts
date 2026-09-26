import { NotFoundException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationSearchService } from './publication-search.service';
import type { PublicationTitleItemsSearchService } from './publication-title-items-search.service';
import type { UserProductFamilyService } from '../../user-products/user-product-family.service';
import type { PublicationsSearchService } from './publications-search.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION = {
  user_id: USER_ID,
  seller_id: 42,
  access_token: 'stored-token',
  refresh_token: 'refresh-token',
  expires_at: '2030-01-01T00:00:00.000Z',
};

describe('PublicationSearchService', () => {
  it('familyId devuelve todos los MLA actuales y fuerza el familyId buscado', async () => {
    const context = createService();
    context.userProductFamily.getFamily.mockResolvedValue({
      familyId: '123456',
      siteId: 'MLA',
      userId: 42,
      userProductIds: ['MLAU1', 'MLAU2'],
    });
    context.publicationsSearch.searchByUserProductIds.mockResolvedValue([
      'MLA1',
      'MLA2',
    ]);
    context.items.getMany.mockResolvedValue([
      { ...item('MLA1'), seller_id: 42, user_product_id: 'MLAU1' },
      { ...item('MLA2'), seller_id: 42, user_product_id: 'MLAU2' },
    ]);

    const result = await context.service.search(USER_ID, '123456');

    expect(result.items.map(({ itemId }) => itemId)).toEqual(['MLA1', 'MLA2']);
    expect(result.items.every(({ familyId }) => familyId === '123456')).toBe(
      true,
    );
    expect(result.items.map(({ userProductId }) => userProductId)).toEqual([
      'MLAU1',
      'MLAU2',
    ]);
    expect(
      context.publicationsSearch.searchByUserProductIds,
    ).toHaveBeenCalledWith(42, ['MLAU1', 'MLAU2'], 'valid-token');
    expect(context.token.getSharedStoredConnection).toHaveBeenCalledTimes(1);
    expect(context.token.getSharedValidAccessToken).toHaveBeenCalledTimes(1);
    expect(context.token.getStoredConnection).not.toHaveBeenCalled();
    expect(context.items.getOne).not.toHaveBeenCalled();
  });

  it('familyId excluye publicaciones que no pertenecen al seller compartido', async () => {
    const context = createService();
    context.userProductFamily.getFamily.mockResolvedValue({
      familyId: '123456',
      siteId: 'MLA',
      userId: 42,
      userProductIds: ['MLAU1'],
    });
    context.publicationsSearch.searchByUserProductIds.mockResolvedValue([
      'MLA1',
      'MLA-FOREIGN',
    ]);
    context.items.getMany.mockResolvedValue([
      { ...item('MLA1'), seller_id: 42 },
      { ...item('MLA-FOREIGN'), seller_id: 99 },
    ]);

    const result = await context.service.search(USER_ID, '123456');

    expect(result.items.map(({ itemId }) => itemId)).toEqual(['MLA1']);
  });

  it('MLAU busca sus MLA y conserva familyId y userProductId', async () => {
    const context = createService();
    context.userProductFamily.resolveFamily.mockResolvedValue({
      userProductId: 'MLAU123',
      userProductName: 'Remera',
      familyId: '900',
      userId: 42,
      userProductIds: ['MLAU123'],
    });
    context.publicationsSearch.searchByUserProductIds.mockResolvedValue([
      'MLA10',
      'MLA11',
    ]);
    context.items.getMany.mockResolvedValue([
      { ...item('MLA10'), seller_id: 42 },
      { ...item('MLA11'), seller_id: 42 },
    ]);

    const result = await context.service.search(USER_ID, 'mlau123');

    expect(
      context.publicationsSearch.searchByUserProductIds,
    ).toHaveBeenCalledWith(42, ['MLAU123'], 'valid-token');
    expect(result.items).toEqual([
      expect.objectContaining({
        itemId: 'MLA10',
        familyId: '900',
        userProductId: 'MLAU123',
      }),
      expect.objectContaining({
        itemId: 'MLA11',
        familyId: '900',
        userProductId: 'MLAU123',
      }),
    ]);
  });

  it('MLAU de otro seller no devuelve publicaciones', async () => {
    const context = createService();
    context.userProductFamily.resolveFamily.mockResolvedValue({
      userProductId: 'MLAU123',
      userProductName: null,
      familyId: '900',
      userId: 99,
      userProductIds: ['MLAU123'],
    });

    const result = await context.service.search(USER_ID, 'MLAU123');

    expect(result.items).toEqual([]);
    expect(
      context.publicationsSearch.searchByUserProductIds,
    ).not.toHaveBeenCalled();
  });

  it('MLA devuelve solamente la publicación exacta', async () => {
    const context = createService();
    context.items.getOne.mockResolvedValue({
      ...item('MLA1947917494'),
      seller_id: 42,
    });

    const result = await context.service.search(USER_ID, 'MLA1947917494');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.itemId).toBe('MLA1947917494');
    expect(context.items.getOne).toHaveBeenCalledWith(
      'MLA1947917494',
      'valid-token',
    );
    expect(context.userProductFamily.getFamily).not.toHaveBeenCalled();
  });

  it('normaliza MLA en minúsculas antes de consultar el item', async () => {
    const context = createService();
    context.items.getOne.mockResolvedValue({
      ...item('MLA1947917494'),
      seller_id: 42,
    });

    await context.service.searchItems(USER_ID, 'mla1947917494');

    expect(context.items.getOne).toHaveBeenCalledWith(
      'MLA1947917494',
      'valid-token',
    );
  });

  it('TITLE devuelve coincidencias normalizadas y paginadas', async () => {
    const context = createService();
    context.title.search.mockResolvedValue({
      done: false,
      nextCursor: 'title-search:2',
      items: [
        {
          ...item('MLA10'),
          title: 'Remera Mujer Cuello V',
          family_id: 900,
        },
      ],
    });

    const result = await context.service.search(
      USER_ID,
      'remera mujer',
      2,
      'title-search:0',
    );

    expect(context.title.search).toHaveBeenCalledWith(
      42,
      'valid-token',
      'remera mujer',
      2,
      'title-search:0',
    );
    expect(result).toMatchObject({
      done: false,
      nextCursor: 'title-search:2',
      itemsCount: 1,
      items: [
        expect.objectContaining({
          itemId: 'MLA10',
          familyId: '900',
          title: 'Remera Mujer Cuello V',
        }),
      ],
    });
  });

  it('TITLE limita la consulta a cuatro resultados', async () => {
    const context = createService();
    context.title.search.mockResolvedValue({
      done: true,
      nextCursor: null,
      items: [],
    });

    await context.service.search(USER_ID, 'remera mujer', 20);

    expect(context.title.search).toHaveBeenCalledWith(
      42,
      'valid-token',
      'remera mujer',
      4,
      undefined,
    );
  });

  it('propaga el comportamiento de dominio para una familia inexistente', async () => {
    const context = createService();
    context.userProductFamily.getFamily.mockRejectedValue(
      new NotFoundException('Familia inexistente'),
    );

    await expect(context.service.search(USER_ID, '999999')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('propaga el comportamiento de Mercado Libre para un MLA inexistente', async () => {
    const context = createService();
    context.items.getOne.mockRejectedValue(
      new NotFoundException('Publicación inexistente'),
    );

    await expect(context.service.search(USER_ID, 'MLA999999')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('una query vacía no ejecuta ninguna llamada', async () => {
    const context = createService();

    await expect(context.service.search(USER_ID, '   ')).rejects.toThrow(
      'q es obligatorio',
    );
    expect(context.token.getStoredConnection).not.toHaveBeenCalled();
    expect(context.userProductFamily.getFamily).not.toHaveBeenCalled();
    expect(context.items.getOne).not.toHaveBeenCalled();
    expect(context.title.search).not.toHaveBeenCalled();
  });

  it('usa una sola conexión, token y consulta para un MLA', async () => {
    const context = createService();
    context.items.getOne.mockResolvedValue({
      ...item('MLA123'),
      seller_id: 42,
    });

    await context.service.search(USER_ID, 'MLA123');

    expect(context.token.getSharedStoredConnection).toHaveBeenCalledTimes(1);
    expect(context.token.getSharedValidAccessToken).toHaveBeenCalledTimes(1);
    expect(context.items.getOne).toHaveBeenCalledTimes(1);
    expect(context.title.search).not.toHaveBeenCalled();
  });

  it('expone MlItem completo internamente sin otra consulta', async () => {
    const context = createService();
    const completeItem = {
      ...item('MLA123'),
      seller_id: 42,
      domain_id: 'MLA-WOMEN_TSHIRTS',
      category_id: 'MLA-CAT',
      attributes: [{ id: 'GENDER', value_name: 'Mujer' }],
      listing_type_id: 'gold_special',
      shipping: { mode: 'me2', logistic_type: 'self_service' },
    };
    context.items.getOne.mockResolvedValue(completeItem);

    const result = await context.service.searchItems(USER_ID, 'MLA123');

    expect(result.items).toEqual([completeItem]);
    expect(result.accessToken).toBe('valid-token');
    expect(context.items.getOne).toHaveBeenCalledTimes(1);
  });
});

function createService() {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue(CONNECTION),
    getValidAccessToken: jest.fn().mockResolvedValue('valid-token'),
    getSharedStoredConnection: jest.fn().mockResolvedValue(CONNECTION),
    getSharedValidAccessToken: jest.fn().mockResolvedValue('valid-token'),
  };
  const items = { getOne: jest.fn(), getMany: jest.fn() };
  const title = { search: jest.fn() };
  const userProductFamily = {
    createCache: jest.fn().mockReturnValue({
      userProducts: new Map(),
      families: new Map(),
      familyByUserProduct: new Map(),
    }),
    getFamily: jest.fn(),
    resolveFamily: jest.fn(),
  };
  const publicationsSearch = { searchByUserProductIds: jest.fn() };
  return {
    token,
    items,
    title,
    userProductFamily,
    publicationsSearch,
    service: new PublicationSearchService(
      token as unknown as MercadolibreTokenService,
      items as unknown as ItemsService,
      title as unknown as PublicationTitleItemsSearchService,
      userProductFamily as unknown as UserProductFamilyService,
      publicationsSearch as unknown as PublicationsSearchService,
    ),
  };
}

function item(id: string): MlItem {
  return {
    id,
    title: `Publicación ${id}`,
    thumbnail: `https://images.example/${id}.jpg`,
    price: 1000,
    currency_id: 'ARS',
    status: 'active',
    available_quantity: 5,
    sold_quantity: 2,
    permalink: `https://articulo.example/${id}`,
  };
}
