import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { AttributesService } from './attributes/attributes.service';
import { DescriptionService } from './description/description.service';
import { FamiliesService } from './families/families.service';
import { FamilyUpdateService } from './families/family-update.service';
import { ItemUpdateService } from './items/item-update.service';
import { ItemsService } from './items/items.service';
import type { MlItem } from './items/items.types';
import { PicturesService } from './pictures/pictures.service';
import { ShippingService } from './shipping/shipping.service';
import { SkuService } from './sku/sku.service';
import { StockService } from './stock/stock.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = 'MLA123';
const ACCESS_TOKEN = 'user-private-access-token';
const CLASSIC_ITEM: MlItem = {
  id: ITEM_ID,
  attributes: [],
  pictures: [],
  variations: [],
};

function tokenSetup() {
  const getValidAccessToken = jest.fn().mockResolvedValue(ACCESS_TOKEN);
  return {
    getValidAccessToken,
    service: { getValidAccessToken } as unknown as MercadolibreTokenService,
  };
}

function itemsSetup(item: MlItem = CLASSIC_ITEM) {
  const getOne = jest.fn().mockResolvedValue(item);
  return {
    getOne,
    service: { getOne } as unknown as ItemsService,
  };
}

describe('servicios de edición por usuario', () => {
  it('propaga userId al consultar stock', async () => {
    const token = tokenSetup();
    const items = itemsSetup();
    const service = new StockService(
      token.service,
      {} as MercadolibreApiService,
      items.service,
    );

    await service.getClassicStock(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar SKU', async () => {
    const token = tokenSetup();
    const get = jest.fn().mockResolvedValue(CLASSIC_ITEM);
    const service = new SkuService(
      token.service,
      { get } as unknown as MercadolibreApiService,
      {} as ItemsService,
    );

    await service.getClassicSku(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar imágenes', async () => {
    const token = tokenSetup();
    const items = itemsSetup();
    const service = new PicturesService(
      token.service,
      {} as MercadolibreApiService,
      items.service,
    );

    await service.getClassicPictures(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar la descripción', async () => {
    const token = tokenSetup();
    const items = itemsSetup();
    const get = jest.fn().mockResolvedValue({ plain_text: 'Descripción' });
    const service = new DescriptionService(
      token.service,
      { get } as unknown as MercadolibreApiService,
      items.service,
    );

    await service.getClassic(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar atributos', async () => {
    const token = tokenSetup();
    const get = jest.fn().mockResolvedValue(CLASSIC_ITEM);
    const service = new AttributesService(token.service, {
      get,
    } as unknown as MercadolibreApiService);

    await service.getClassic(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar envío', async () => {
    const token = tokenSetup();
    const items = itemsSetup();
    const service = new ShippingService(
      token.service,
      {} as MercadolibreApiService,
      items.service,
    );

    await service.getClassic(USER_ID, ITEM_ID);

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al editar un ítem', async () => {
    const token = tokenSetup();
    const items = itemsSetup();
    const put = jest.fn().mockResolvedValue(CLASSIC_ITEM);
    const service = new ItemUpdateService(
      token.service,
      { put } as unknown as MercadolibreApiService,
      items.service,
    );

    await service.updateClassic(USER_ID, ITEM_ID, { status: 'paused' });

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });

  it('propaga userId al consultar una tarea de familia', async () => {
    const token = tokenSetup();
    const get = jest.fn().mockResolvedValue({ status: 'completed' });
    const service = new FamilyUpdateService(
      {} as FamiliesService,
      { get } as unknown as MercadolibreApiService,
      token.service,
    );

    await service.getTaskStatus(USER_ID, 'task-123');

    expect(token.getValidAccessToken).toHaveBeenCalledWith(USER_ID);
  });
});
