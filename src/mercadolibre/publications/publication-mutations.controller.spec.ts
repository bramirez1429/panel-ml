import { PublicationMutationsController } from './publication-mutations.controller';
import { PublicationAttributesService } from './mutations/publication-attributes.service';
import { PublicationDescriptionService } from './mutations/publication-description.service';
import { PublicationPicturesService } from './mutations/publication-pictures.service';
import { PublicationPriceService } from './mutations/publication-price.service';
import { PublicationSkuService } from './mutations/publication-sku.service';
import { PublicationStatusService } from './mutations/publication-status.service';
import { PublicationStockService } from './mutations/publication-stock.service';
import { PublicationTitleService } from './mutations/publication-title.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationMutationsController', () => {
  const updatePrice = jest.fn();
  const updateStock = jest.fn();
  const updateStatus = jest.fn();
  const updateSku = jest.fn();
  const updatePictures = jest.fn();
  const updateTitle = jest.fn();
  const updateDescription = jest.fn();
  const updateAttributes = jest.fn();
  let controller: PublicationMutationsController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new PublicationMutationsController(
      { update: updatePrice } as unknown as PublicationPriceService,
      { update: updateStock } as unknown as PublicationStockService,
      { update: updateStatus } as unknown as PublicationStatusService,
      { update: updateSku } as unknown as PublicationSkuService,
      { update: updatePictures } as unknown as PublicationPicturesService,
      { update: updateTitle } as unknown as PublicationTitleService,
      { update: updateDescription } as unknown as PublicationDescriptionService,
      { update: updateAttributes } as unknown as PublicationAttributesService,
    );
  });

  it('delega precio, stock, estado y SKU sin transformar payloads', async () => {
    const price = { price: 48_000 };
    const stock = { stock: 12, itemId: 'MLA123', variationId: '456' };
    const status = { status: 'paused' };
    const sku = { sku: 'SKU-12', variationId: '456' };

    await controller.updatePrice(PRODUCT_ID, price);
    await controller.updateStock(PRODUCT_ID, stock);
    await controller.updateStatus(PRODUCT_ID, status);
    await controller.updateSku(PRODUCT_ID, sku);

    expect(updatePrice).toHaveBeenCalledWith(PRODUCT_ID, price);
    expect(updateStock).toHaveBeenCalledWith(PRODUCT_ID, stock);
    expect(updateStatus).toHaveBeenCalledWith(PRODUCT_ID, status);
    expect(updateSku).toHaveBeenCalledWith(PRODUCT_ID, sku);
  });

  it('delega título, descripción y atributos', async () => {
    const title = { title: 'Título actualizado' };
    const description = { description: 'Descripción actualizada' };
    const attributes = { attributes: [{ id: 'BRAND', value_name: 'Marca' }] };

    await controller.updateTitle(PRODUCT_ID, title);
    await controller.updateDescription(PRODUCT_ID, description);
    await controller.updateAttributes(PRODUCT_ID, attributes);

    expect(updateTitle).toHaveBeenCalledWith(PRODUCT_ID, title);
    expect(updateDescription).toHaveBeenCalledWith(PRODUCT_ID, description);
    expect(updateAttributes).toHaveBeenCalledWith(PRODUCT_ID, attributes);
  });

  it('delega el contrato multipart único de imágenes', async () => {
    const body = { operation: 'remove', pictureId: 'P1' };

    await controller.updatePictures(PRODUCT_ID, body);

    expect(updatePictures).toHaveBeenCalledWith(PRODUCT_ID, body, undefined);
  });
});
