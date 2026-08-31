import { NotFoundException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { FamiliesService } from '../families/families.service';
import type { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';
import { PublicationSearchService } from './publication-search.service';
import type { PublicationTitleItemsSearchService } from './publication-title-items-search.service';

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
    context.families.getFamilyItems.mockResolvedValue({
      family: { user_id: 42 },
      itemIds: ['MLA1', 'MLA2'],
      accessToken: 'token',
      items: [item('MLA1'), item('MLA2')],
    });

    const result = await context.service.search(USER_ID, '123456');

    expect(result.items.map(({ itemId }) => itemId)).toEqual(['MLA1', 'MLA2']);
    expect(result.items.every(({ familyId }) => familyId === '123456')).toBe(
      true,
    );
    expect(context.families.getFamilyItems).toHaveBeenCalledTimes(1);
    expect(context.token.getStoredConnection).not.toHaveBeenCalled();
    expect(context.items.getOne).not.toHaveBeenCalled();
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
    expect(context.families.getFamilyItems).not.toHaveBeenCalled();
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

  it('propaga el comportamiento de dominio para una familia inexistente', async () => {
    const context = createService();
    context.families.getFamilyItems.mockRejectedValue(
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
    expect(context.families.getFamilyItems).not.toHaveBeenCalled();
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

    expect(context.token.getStoredConnection).toHaveBeenCalledTimes(1);
    expect(context.token.getValidAccessToken).toHaveBeenCalledTimes(1);
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
  };
  const families = { getFamilyItems: jest.fn() };
  const items = { getOne: jest.fn() };
  const title = { search: jest.fn() };
  return {
    token,
    families,
    items,
    title,
    service: new PublicationSearchService(
      token as unknown as MercadolibreTokenService,
      families as unknown as FamiliesService,
      items as unknown as ItemsService,
      title as unknown as PublicationTitleItemsSearchService,
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
