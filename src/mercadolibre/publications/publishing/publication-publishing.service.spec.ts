import { BadRequestException, ConflictException } from '@nestjs/common';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationPublishingPlannerService } from './publication-publishing-planner.service';
import { PublicationPublishingService } from './publication-publishing.service';
import { PublishingPlan } from './publication-publishing.types';
import { PublicationValidationService } from './publication-validation.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ITEM = { description: null, payload: { title: 'Prueba' } };
const PLAN: PublishingPlan = {
  context: {
    sellerId: 42,
    accessToken: 'token',
    usesUserProducts: false,
    managesWarehouse: false,
  },
  model: 'LEGACY',
  items: [ITEM],
};

describe('PublicationPublishingService', () => {
  const plan = jest.fn();
  const validatePlan = jest.fn();
  const post = jest.fn();
  const syncKnownItems = jest.fn();
  const findByExternalKey = jest.fn();
  const recordBestEffort = jest.fn();
  const service = new PublicationPublishingService(
    { plan } as unknown as PublicationPublishingPlannerService,
    { validatePlan } as unknown as PublicationValidationService,
    { post } as unknown as MercadolibreApiService,
    { syncKnownItems } as unknown as PublicationSyncService,
    { findByExternalKey } as unknown as MercadolibreProductsRepository,
    { recordBestEffort } as unknown as PublicationActivityService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    plan.mockResolvedValue(PLAN);
    validatePlan.mockResolvedValue({ valid: true, issues: [], preview: {} });
    syncKnownItems.mockResolvedValue('item:MLA123');
    findByExternalKey.mockResolvedValue({ id: PRODUCT_ID });
    recordBestEffort.mockResolvedValue(undefined);
  });

  it('crea en ML, sincroniza de forma dirigida y devuelve productId', async () => {
    post.mockResolvedValue({ id: 'MLA123', seller_id: 42 });

    await expect(service.publish({})).resolves.toEqual({
      ok: true,
      productId: PRODUCT_ID,
      publishingModel: 'LEGACY',
      itemIds: ['MLA123'],
    });
    expect(syncKnownItems).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'MLA123', seller_id: 42 })],
      { sellerId: 42, accessToken: 'token' },
    );
    expect(findByExternalKey).toHaveBeenCalledWith(42, 'item:MLA123');
    expect(recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: PRODUCT_ID,
        action: 'PUBLISHED',
        status: 'SUCCESS',
      }),
    );
  });

  it('no toca Supabase si ML crea solo una parte de una familia', async () => {
    plan.mockResolvedValue({ ...PLAN, items: [ITEM, ITEM] });
    post
      .mockResolvedValueOnce({ id: 'MLA123', seller_id: 42 })
      .mockRejectedValueOnce(new BadRequestException('rechazado'));

    await expect(service.publish({})).rejects.toBeInstanceOf(ConflictException);
    expect(syncKnownItems).not.toHaveBeenCalled();
    expect(findByExternalKey).not.toHaveBeenCalled();
    expect(recordBestEffort).not.toHaveBeenCalled();
  });

  it('no toca Supabase cuando ML rechaza la descripcion', async () => {
    plan.mockResolvedValue({
      ...PLAN,
      items: [{ ...ITEM, description: 'Descripcion' }],
    });
    post
      .mockResolvedValueOnce({ id: 'MLA123', seller_id: 42 })
      .mockRejectedValueOnce(new BadRequestException('descripcion rechazada'));

    let caught: unknown;
    try {
      await service.publish({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    if (!(caught instanceof ConflictException)) throw caught;
    expect(caught.getResponse()).toEqual(
      expect.objectContaining({ createdItemIds: ['MLA123'] }),
    );
    expect(syncKnownItems).not.toHaveBeenCalled();
    expect(findByExternalKey).not.toHaveBeenCalled();
  });

  it('no sincroniza si ML separa los items en familias distintas', async () => {
    plan.mockResolvedValue({
      ...PLAN,
      model: 'USER_PRODUCTS',
      items: [ITEM, ITEM],
    });
    post
      .mockResolvedValueOnce({ id: 'MLA123', seller_id: 42 })
      .mockResolvedValueOnce({ id: 'MLA124', seller_id: 42 });
    syncKnownItems.mockRejectedValueOnce(
      new ConflictException('familias distintas'),
    );

    await expect(service.publish({})).rejects.toBeInstanceOf(ConflictException);
    expect(syncKnownItems).toHaveBeenCalledTimes(1);
    expect(findByExternalKey).not.toHaveBeenCalled();
  });

  it('devuelve los IDs creados si el producto sincronizado no puede localizarse', async () => {
    post.mockResolvedValueOnce({ id: 'MLA123', seller_id: 42 });
    findByExternalKey.mockResolvedValueOnce(null);

    let caught: unknown;
    try {
      await service.publish({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConflictException);
    if (!(caught instanceof ConflictException)) throw caught;
    expect(caught.getResponse()).toEqual(
      expect.objectContaining({ createdItemIds: ['MLA123'] }),
    );
    expect(recordBestEffort).not.toHaveBeenCalled();
  });
});
