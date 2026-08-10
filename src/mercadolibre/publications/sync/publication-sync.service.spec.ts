import { ForbiddenException } from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationModelDetectorService } from '../normalization/publication-model-detector.service';
import { NormalizedPublicationBundle } from '../publication.types';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import { PublicationSyncService } from './publication-sync.service';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

/** Crea un bundle persistible para cada modelo. */
function bundle(
  model: 'SHARED' | 'VARIANT_PRICING',
): NormalizedPublicationBundle {
  const shared = model === 'SHARED';
  return {
    parent: {
      seller_id: 123,
      external_key: shared ? 'item:MLA1' : 'family:9',
      model,
      family_id: shared ? null : '9',
      parent_item_id: shared ? 'MLA1' : null,
      family_name: shared ? null : 'Familia',
      title: shared ? 'Producto' : 'Familia',
      shared_variations: [],
    },
    children: shared ? [] : [{ item_id: 'MLA2', user_product_id: 'MLAU2' }],
  };
}

/** Crea el orquestador con dependencias controladas. */
function setup() {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 123 }),
    getValidAccessToken: jest.fn().mockResolvedValue('private-token'),
  };
  const source = {
    getAllItemIds: jest.fn().mockResolvedValue(['MLA1', 'MLA2']),
    getPublicationDetails: jest.fn().mockResolvedValue({
      publications: [
        { id: 'MLA1', family_name: null, seller_id: 123 },
        { id: 'MLA2', family_name: 'Familia', seller_id: 123 },
      ],
      errors: [],
    }),
    getItem: jest.fn(),
    getItemIdsForUserProducts: jest.fn(),
  };
  const family = {
    createCache: jest.fn().mockReturnValue({
      userProducts: new Map(),
      families: new Map(),
      familyByUserProduct: new Map(),
    }),
    resolveFamily: jest.fn(),
  };
  const preparer = {
    prepare: jest.fn().mockResolvedValue({
      bundles: [bundle('SHARED'), bundle('VARIANT_PRICING')],
      errors: [],
    }),
  };
  const writer = {
    save: jest.fn().mockResolvedValue(undefined),
    finalizeFullSync: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PublicationSyncService(
    token as unknown as MercadolibreTokenService,
    source as unknown as PublicationSourceService,
    family as unknown as UserProductFamilyService,
    new PublicationModelDetectorService(),
    preparer as unknown as PublicationSyncPreparerService,
    writer as unknown as PublicationSyncWriterService,
  );
  return { preparer, service, source, writer };
}

describe('PublicationSyncService', () => {
  it('guarda todo y limpia solamente al completar sin errores', async () => {
    const { service, writer } = setup();

    const result = await service.syncAll();

    expect(result).toMatchObject({
      ok: true,
      totalItemIds: 2,
      processedItems: 2,
      productsSaved: 2,
      childrenSaved: 1,
      cleanupPerformed: true,
      errors: [],
    });
    expect(writer.save).toHaveBeenCalledTimes(2);
    expect(writer.finalizeFullSync).toHaveBeenCalledWith(
      123,
      result.syncId,
      expect.any(String),
    );
  });

  it('conserva datos anteriores y solo guarda SHARED ante errores parciales', async () => {
    const { service, source, writer } = setup();
    source.getPublicationDetails.mockResolvedValue({
      publications: [
        { id: 'MLA1', family_name: null, seller_id: 123 },
        { id: 'MLA2', family_name: 'Familia', seller_id: 123 },
      ],
      errors: [{ itemId: 'MLA3', status: 404, body: { message: 'Not found' } }],
    });

    const result = await service.syncAll();

    expect(result.cleanupPerformed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(writer.save).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledWith(bundle('SHARED'), result.syncId);
    expect(writer.finalizeFullSync).not.toHaveBeenCalled();
  });

  it('rechaza un MLA puntual que no pertenece al vendedor conectado', async () => {
    const { service, source, writer } = setup();
    source.getItem.mockResolvedValue({
      id: 'MLA999',
      family_name: null,
      seller_id: 999,
    });

    await expect(service.syncItem('MLA999', 123)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(writer.save).not.toHaveBeenCalled();
  });
});
