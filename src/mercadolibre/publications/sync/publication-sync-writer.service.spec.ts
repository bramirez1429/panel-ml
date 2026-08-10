import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreProductsRepository } from '../../../database/repositories/mercadolibre-products.repository';
import { NormalizedPublicationBundle } from '../publication.types';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const SYNC_ID = '11111111-1111-4111-8111-111111111111';

/** Crea un bundle SHARED m\u00ednimo. */
function sharedBundle(): NormalizedPublicationBundle {
  return {
    parent: {
      seller_id: 123,
      external_key: 'item:MLA1',
      model: 'SHARED',
      family_id: null,
      parent_item_id: 'MLA1',
      family_name: null,
      title: 'Producto',
      shared_variations: [],
    },
    children: [],
  };
}

/** Crea un bundle familiar con un MLA. */
function familyBundle(): NormalizedPublicationBundle {
  return {
    parent: {
      seller_id: 123,
      external_key: 'family:9',
      model: 'VARIANT_PRICING',
      family_id: '9',
      parent_item_id: null,
      family_name: 'Familia',
      title: 'Familia',
      shared_variations: [],
    },
    children: [{ item_id: 'MLA2', user_product_id: 'MLAU2' }],
  };
}

/** Crea el writer con repositories simulados. */
function setup() {
  const products = {
    upsert: jest.fn().mockResolvedValue({ id: PRODUCT_ID }),
    markFullSync: jest.fn().mockResolvedValue(undefined),
    deleteNotSeenInFullSync: jest.fn().mockResolvedValue(undefined),
    deleteByExternalKeys: jest.fn().mockResolvedValue(undefined),
  };
  const children = {
    upsertMany: jest.fn().mockResolvedValue(undefined),
    deleteMissingChildren: jest.fn().mockResolvedValue(undefined),
    deleteByProductId: jest.fn().mockResolvedValue(undefined),
    deleteByItemId: jest.fn().mockResolvedValue(undefined),
  };
  const writer = new PublicationSyncWriterService(
    products as unknown as MercadolibreProductsRepository,
    children as unknown as MercadolibreChildrenRepository,
  );
  return { children, products, writer };
}

describe('PublicationSyncWriterService', () => {
  it('guarda SHARED sin hijos y lo marca al completar', async () => {
    const { children, products, writer } = setup();

    await writer.save(sharedBundle(), SYNC_ID);

    expect(children.deleteByItemId).toHaveBeenCalledWith('MLA1');
    expect(children.deleteByProductId).toHaveBeenCalledWith(PRODUCT_ID);
    expect(children.upsertMany).not.toHaveBeenCalled();
    expect(products.markFullSync).toHaveBeenCalledWith(
      123,
      ['item:MLA1'],
      SYNC_ID,
    );
  });

  it('guarda la familia, reconcilia hijos y elimina SHARED anteriores', async () => {
    const { children, products, writer } = setup();

    await writer.save(familyBundle());

    expect(children.upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ product_id: PRODUCT_ID, item_id: 'MLA2' }),
    ]);
    expect(children.deleteMissingChildren).toHaveBeenCalledWith(PRODUCT_ID, [
      'MLA2',
    ]);
    expect(products.deleteByExternalKeys).toHaveBeenCalledWith(123, [
      'item:MLA2',
    ]);
  });

  it('finaliza usando el inicio de corrida para proteger escrituras nuevas', async () => {
    const { products, writer } = setup();
    const startedAt = '2026-08-09T12:00:00.000Z';

    await writer.finalizeFullSync(123, SYNC_ID, startedAt);

    expect(products.deleteNotSeenInFullSync).toHaveBeenCalledWith(
      123,
      SYNC_ID,
      startedAt,
    );
  });
});
