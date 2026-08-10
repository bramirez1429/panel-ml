import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationFamilySyncService } from './publication-family-sync.service';
import { PublicationSourceService } from './publication-source.service';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';
import { PublicationSyncWriterService } from './publication-sync-writer.service';

const FULL_SYNC_ID = '11111111-1111-4111-8111-111111111111';

/** Crea el servicio con una familia compartida por dos MLA. */
function setup() {
  const cache = {
    userProducts: new Map(),
    families: new Map(),
    familyByUserProduct: new Map(),
  };
  const family = {
    createCache: jest.fn().mockReturnValue(cache),
    resolveFamily: jest.fn().mockImplementation((userProductId: string) =>
      Promise.resolve({
        userProductId,
        userProductName: userProductId,
        familyId: '9',
        userId: 123,
        userProductIds: ['MLAU1', 'MLAU2'],
      }),
    ),
  };
  const source = {
    getItemIdsForUserProducts: jest.fn().mockResolvedValue(['MLA2']),
    getPublicationDetails: jest.fn().mockResolvedValue({
      publications: [
        { id: 'MLA1', user_product_id: 'MLAU1' },
        { id: 'MLA2', user_product_id: 'MLAU2' },
      ],
      errors: [],
    }),
  };
  const bundle = {
    parent: { family_id: '9' },
    children: [
      { item_id: 'MLA1', user_product_id: 'MLAU1' },
      { item_id: 'MLA2', user_product_id: 'MLAU2' },
    ],
  };
  const preparer = {
    prepare: jest.fn().mockResolvedValue({ bundles: [bundle], errors: [] }),
  };
  const writer = { save: jest.fn().mockResolvedValue(undefined) };
  const service = new PublicationFamilySyncService(
    family as unknown as UserProductFamilyService,
    source as unknown as PublicationSourceService,
    preparer as unknown as PublicationSyncPreparerService,
    writer as unknown as PublicationSyncWriterService,
  );
  return { bundle, family, service, source, writer };
}

describe('PublicationFamilySyncService', () => {
  it('reconstruye una familia completa una sola vez por batch', async () => {
    const { bundle, service, source, writer } = setup();

    const result = await service.syncBatch(
      [
        { id: 'MLA1', user_product_id: 'MLAU1' },
        { id: 'MLA2', user_product_id: 'MLAU2' },
      ],
      { sellerId: 123, accessToken: 'private-token' },
      FULL_SYNC_ID,
    );

    expect(result).toEqual({
      productsSaved: 1,
      childrenSaved: 2,
      errors: [],
    });
    expect(source.getItemIdsForUserProducts).toHaveBeenCalledTimes(1);
    expect(source.getPublicationDetails).toHaveBeenCalledWith(
      ['MLA2', 'MLA1'],
      'private-token',
    );
    expect(writer.save).toHaveBeenCalledWith(bundle, FULL_SYNC_ID);
  });

  it('cuenta un error individual y continúa con otra familia', async () => {
    const { family, service, writer } = setup();
    family.resolveFamily
      .mockRejectedValueOnce(new Error('User Product inválido'))
      .mockResolvedValueOnce({
        userProductId: 'MLAU2',
        userProductName: null,
        familyId: '9',
        userId: 123,
        userProductIds: ['MLAU2'],
      });

    const result = await service.syncBatch(
      [
        { id: 'MLA1', user_product_id: 'MLAU1' },
        { id: 'MLA2', user_product_id: 'MLAU2' },
      ],
      { sellerId: 123, accessToken: 'private-token' },
      FULL_SYNC_ID,
    );

    expect(result.errors).toEqual([
      { itemId: 'MLA1', message: 'User Product inválido' },
    ]);
    expect(result.productsSaved).toBe(1);
    expect(writer.save).toHaveBeenCalledTimes(1);
  });

  it('propaga una falla de persistencia como fatal', async () => {
    const { service, writer } = setup();
    writer.save.mockRejectedValue(
      new ServiceUnavailableException('No se pudo guardar'),
    );

    await expect(
      service.syncBatch(
        [{ id: 'MLA1', user_product_id: 'MLAU1' }],
        { sellerId: 123, accessToken: 'private-token' },
        FULL_SYNC_ID,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('propaga una falla sistémica de Mercado Libre como fatal', async () => {
    const { family, service, writer } = setup();
    family.resolveFamily.mockRejectedValue(
      new BadGatewayException('Mercado Libre no respondió'),
    );

    await expect(
      service.syncBatch(
        [{ id: 'MLA1', user_product_id: 'MLAU1' }],
        { sellerId: 123, accessToken: 'private-token' },
        FULL_SYNC_ID,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(writer.save).not.toHaveBeenCalled();
  });
});
