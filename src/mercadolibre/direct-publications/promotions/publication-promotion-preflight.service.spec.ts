import type { PromotionsService } from './promotions.service';
import { PublicationPromotionPreflightService } from './publication-promotion-preflight.service';
import type { ResolvedPromotionSource } from './publication-promotion.types';

const REQUEST = {
  type: 'DEAL' as const,
  promotionId: 'campaign-1',
  dealPrice: 80,
};

describe('PublicationPromotionPreflightService', () => {
  it('habilita la operación cuando la candidate está en 8 de 8 MLA', async () => {
    const promotions = promotionMock(() => [candidate()]);
    const service = new PublicationPromotionPreflightService(
      promotions as unknown as PromotionsService,
    );

    const preview = await service.preview('user', source(8), REQUEST);

    expect(preview).toMatchObject({
      sourceKey: 'family:123',
      totalItems: 8,
      applicableItems: 8,
      unavailableItems: 0,
    });
    expect(preview.items).toHaveLength(8);
  });

  it('informa explícitamente 6 de 8 MLA aplicables', async () => {
    let call = 0;
    const promotions = promotionMock(() => {
      call += 1;
      return call <= 6 ? [candidate()] : [];
    });
    const service = new PublicationPromotionPreflightService(
      promotions as unknown as PromotionsService,
    );

    const preview = await service.preview('user', source(8), REQUEST);

    expect(preview).toMatchObject({
      totalItems: 8,
      applicableItems: 6,
      unavailableItems: 2,
    });
    expect(preview.items.filter((item) => !item.applicable)).toHaveLength(2);
    expect(promotions.getPromotionsStrict).toHaveBeenCalledTimes(8);
  });
});

function source(count: number): ResolvedPromotionSource {
  return {
    sourceKey: 'family:123',
    accessToken: 'token',
    items: Array.from({ length: count }, (_, index) => ({
      item: { id: `MLA${index + 1}`, family_id: 123, price: 100 },
      publication: {
        type: 'NEW' as const,
        familyId: '123',
        itemId: `MLA${index + 1}`,
      },
    })),
  };
}

function candidate() {
  return {
    id: 'campaign-1',
    type: 'DEAL',
    status: 'candidate',
    price: 80,
    start_date: '2026-01-01',
    finish_date: '2026-12-31',
  };
}

function promotionMock(candidates: () => object[]) {
  return {
    getPromotionsStrict: jest.fn().mockImplementation(() =>
      Promise.resolve({
        active: [],
        candidates: candidates(),
        pending: [],
        all: [],
      }),
    ),
  };
}
