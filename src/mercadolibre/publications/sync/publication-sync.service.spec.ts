import { ForbiddenException } from '@nestjs/common';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationModelDetectorService } from '../normalization/publication-model-detector.service';
import { PublicationOfficialPriceService } from '../prices/publication-official-price.service';
import {
  MercadoLibrePublication,
  NormalizedPublicationBundle,
} from '../publication.types';
import { PublicationFamilySyncService } from './publication-family-sync.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import { PublicationSyncService } from './publication-sync.service';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

const FULL_SYNC_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS = { sellerId: 123, accessToken: 'private-token' };
const SHARED: MercadoLibrePublication = {
  id: 'MLA1',
  family_name: null,
  seller_id: 123,
};
const VARIANT: MercadoLibrePublication = {
  id: 'MLA2',
  family_name: 'Familia',
  seller_id: 123,
  user_product_id: 'MLAU2',
};

/** Crea un bundle SHARED persistible. */
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

/** Crea el orquestador con dependencias controladas. */
function setup() {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 123 }),
    getValidAccessToken: jest.fn().mockResolvedValue('private-token'),
  };
  const source = {
    getPublicationDetails: jest.fn().mockResolvedValue({
      publications: [SHARED, VARIANT],
      errors: [],
    }),
    getItem: jest.fn().mockResolvedValue(SHARED),
  };
  const family = {
    createCache: jest.fn().mockReturnValue({
      userProducts: new Map(),
      families: new Map(),
      familyByUserProduct: new Map(),
    }),
  };
  const preparer = {
    prepare: jest.fn().mockResolvedValue({
      bundles: [sharedBundle()],
      errors: [],
    }),
  };
  const familySync = {
    syncBatch: jest.fn().mockResolvedValue({
      productsSaved: 1,
      childrenSaved: 2,
      errors: [],
    }),
    syncPublication: jest.fn().mockResolvedValue(undefined),
    syncPublications: jest.fn().mockResolvedValue('9'),
  };
  const writer = {
    save: jest.fn().mockResolvedValue(undefined),
    finalizeFullSync: jest.fn().mockResolvedValue(undefined),
  };
  const officialPrices = {
    hydrateMany: jest.fn((publications: MercadoLibrePublication[]) =>
      Promise.resolve(publications),
    ),
  };
  const service = new PublicationSyncService(
    token as unknown as MercadolibreTokenService,
    source as unknown as PublicationSourceService,
    family as unknown as UserProductFamilyService,
    new PublicationModelDetectorService(),
    preparer as unknown as PublicationSyncPreparerService,
    familySync as unknown as PublicationFamilySyncService,
    writer as unknown as PublicationSyncWriterService,
    officialPrices as unknown as PublicationOfficialPriceService,
  );
  return { familySync, preparer, service, source, writer };
}

describe('PublicationSyncService', () => {
  it('procesa SHARED y delega familias dentro del batch', async () => {
    const { familySync, preparer, service, source, writer } = setup();

    await expect(
      service.syncBatch(['MLA1', 'MLA2'], ACCESS, FULL_SYNC_ID),
    ).resolves.toEqual({
      productsSaved: 2,
      childrenSaved: 2,
      errors: [],
    });

    expect(source.getPublicationDetails).toHaveBeenCalledWith(
      ['MLA1', 'MLA2'],
      'private-token',
    );
    expect(preparer.prepare).toHaveBeenCalledTimes(1);
    expect(writer.save).toHaveBeenCalledWith(sharedBundle(), FULL_SYNC_ID);
    expect(familySync.syncBatch).toHaveBeenCalledWith(
      [VARIANT],
      ACCESS,
      FULL_SYNC_ID,
    );
  });

  it('acumula errores individuales y conserva resultados válidos', async () => {
    const { familySync, preparer, service, source } = setup();
    source.getPublicationDetails.mockResolvedValue({
      publications: [
        SHARED,
        VARIANT,
        { ...SHARED, id: 'MLA9', seller_id: 999 },
      ],
      errors: [{ itemId: 'MLA3', status: 404, body: { message: 'Not found' } }],
    });
    preparer.prepare.mockResolvedValue({
      bundles: [sharedBundle()],
      errors: [{ itemId: 'MLA4', message: 'No se pudo normalizar' }],
    });
    familySync.syncBatch.mockResolvedValue({
      productsSaved: 0,
      childrenSaved: 0,
      errors: [{ itemId: 'MLA2', message: 'Familia incompleta' }],
    });

    const result = await service.syncBatch(
      ['MLA1', 'MLA2', 'MLA3'],
      ACCESS,
      FULL_SYNC_ID,
    );

    expect(result.productsSaved).toBe(1);
    expect(result.errors).toHaveLength(4);
  });

  it('sincroniza un webhook SHARED sin marca de full sync', async () => {
    const { familySync, service, writer } = setup();

    await service.syncItem('MLA1', 123);

    expect(writer.save).toHaveBeenCalledWith(sharedBundle());
    expect(familySync.syncPublication).not.toHaveBeenCalled();
  });

  it('delega un webhook VARIANT a la reconstrucción de familia', async () => {
    const { familySync, service, source, writer } = setup();
    source.getItem.mockResolvedValue(VARIANT);

    await service.syncItem('MLA2', 123);

    expect(familySync.syncPublications).toHaveBeenCalledWith(
      [VARIANT],
      ACCESS,
    );
    expect(writer.save).not.toHaveBeenCalled();
  });

  it('sincroniza un item ya disponible sin volver a pedirlo', async () => {
    const { service, source, writer } = setup();

    await service.syncKnownItem(SHARED, ACCESS);

    expect(source.getItem).not.toHaveBeenCalled();
    expect(writer.save).toHaveBeenCalledWith(sharedBundle());
  });

  it('rechaza un item conocido que pertenece a otro seller', async () => {
    const { service, writer } = setup();

    await expect(
      service.syncKnownItem({ ...SHARED, seller_id: 999 }, ACCESS),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writer.save).not.toHaveBeenCalled();
  });

  it('rechaza un webhook informado para otro vendedor', async () => {
    const { service, source } = setup();

    await expect(service.syncItem('MLA1', 999)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(source.getItem).not.toHaveBeenCalled();
  });

  it('delega la limpieza final al writer', async () => {
    const { service, writer } = setup();
    const startedAt = '2026-08-10T12:00:00.000Z';

    await service.finalizeFullSync(123, FULL_SYNC_ID, startedAt);

    expect(writer.finalizeFullSync).toHaveBeenCalledWith(
      123,
      FULL_SYNC_ID,
      startedAt,
    );
  });
});
