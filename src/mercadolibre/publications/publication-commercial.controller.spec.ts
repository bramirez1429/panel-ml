import { PublicationCommercialController } from './publication-commercial.controller';
import { PublicationActivityService } from './activity/publication-activity.service';
import { PublicationCapabilitiesService } from './mutations/publication-capabilities.service';
import { PublicationPricesService } from './prices/publication-prices.service';
import { PublicationPromotionsService } from './promotions/publication-promotions.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = 'MLA123';

describe('PublicationCommercialController', () => {
  const getPrices = jest.fn();
  const getPromotions = jest.fn();
  const listActivity = jest.fn();
  const getCapabilities = jest.fn();
  const applyPriceDiscount = jest.fn();
  const removePriceDiscount = jest.fn();
  let controller: PublicationCommercialController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new PublicationCommercialController(
      { get: getPrices } as unknown as PublicationPricesService,
      {
        get: getPromotions,
        applyPriceDiscount,
        removePriceDiscount,
      } as unknown as PublicationPromotionsService,
      { list: listActivity } as unknown as PublicationActivityService,
      { get: getCapabilities } as unknown as PublicationCapabilitiesService,
    );
  });

  it('delega precios, promociones, actividad y capabilities', async () => {
    await controller.getPrices(PRODUCT_ID, ITEM_ID);
    await controller.getPromotions(PRODUCT_ID, ITEM_ID);
    await controller.getActivity(PRODUCT_ID, ITEM_ID);
    await controller.getCapabilities(PRODUCT_ID, ITEM_ID);

    expect(getPrices).toHaveBeenCalledWith(PRODUCT_ID, ITEM_ID);
    expect(getPromotions).toHaveBeenCalledWith(PRODUCT_ID, ITEM_ID);
    expect(listActivity).toHaveBeenCalledWith(PRODUCT_ID, ITEM_ID, undefined);
    expect(getCapabilities).toHaveBeenCalledWith(PRODUCT_ID, ITEM_ID);
  });

  it('delega aplicación y eliminación de PRICE_DISCOUNT', async () => {
    const body = { price: 80_000 };

    await controller.applyPriceDiscount(PRODUCT_ID, body);
    await controller.removePriceDiscount(PRODUCT_ID, body, ITEM_ID);

    expect(applyPriceDiscount).toHaveBeenCalledWith(PRODUCT_ID, body);
    expect(removePriceDiscount).toHaveBeenCalledWith(PRODUCT_ID, body, ITEM_ID);
  });
});
