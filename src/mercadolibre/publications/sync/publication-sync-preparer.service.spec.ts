import { ServiceUnavailableException } from '@nestjs/common';
import { UserProductFamilyService } from '../../user-products/user-product-family.service';
import { PublicationNormalizerService } from '../normalization/publication-normalizer.service';
import { MercadoLibrePublication } from '../publication.types';
import { PublicationSyncPreparerService } from './publication-sync-preparer.service';

function publication(index: number): MercadoLibrePublication {
  return {
    id: `MLA${index}`,
    user_product_id: `MLAU${index}`,
  };
}

function setup(resolveFamily: jest.Mock): PublicationSyncPreparerService {
  return new PublicationSyncPreparerService(
    {
      detect: jest.fn().mockReturnValue('VARIANT_PRICING'),
    },
    {
      normalizeVariantFamily: jest.fn().mockReturnValue({
        parent: {},
        children: [],
      }),
    } as unknown as PublicationNormalizerService,
    { resolveFamily } as unknown as UserProductFamilyService,
  );
}

const cache = () => ({
  userProducts: new Map(),
  families: new Map(),
  familyByUserProduct: new Map(),
});

describe('PublicationSyncPreparerService concurrency', () => {
  it('limita a dos las resoluciones concurrentes', async () => {
    let active = 0;
    let maximum = 0;
    const resolveFamily = jest.fn(async (userProductId: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        familyId: userProductId,
        userId: 123,
        userProductId,
        userProductName: null,
        userProductIds: [userProductId],
      };
    });

    await setup(resolveFamily).prepare(
      [1, 2, 3, 4, 5].map(publication),
      'private-token',
      { sellerId: 123, syncedAt: '2026-08-11T00:00:00.000Z' },
      cache(),
    );

    expect(maximum).toBe(2);
  });

  it('propaga el rate limit para que el job vuelva a PENDING', async () => {
    const error = new ServiceUnavailableException('Demasiadas solicitudes');
    const resolveFamily = jest.fn().mockRejectedValue(error);

    await expect(
      setup(resolveFamily).prepare(
        [publication(1)],
        'private-token',
        { sellerId: 123, syncedAt: '2026-08-11T00:00:00.000Z' },
        cache(),
      ),
    ).rejects.toBe(error);
  });
});
