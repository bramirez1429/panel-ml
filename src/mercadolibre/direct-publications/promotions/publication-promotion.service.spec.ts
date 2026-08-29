import type { PublicationPromotionExecutorService } from './publication-promotion-executor.service';
import type { PublicationPromotionPreflightService } from './publication-promotion-preflight.service';
import type { PublicationPromotionSourceService } from './publication-promotion-source.service';
import { PublicationPromotionService } from './publication-promotion.service';
import type { PromotionExecutionContext } from './publication-promotion.types';

const REQUEST = {
  type: 'DEAL' as const,
  promotionId: 'campaign-1',
  dealPrice: 80,
};

describe('PublicationPromotionService', () => {
  it('permite escribir sólo después de un preflight 8/8', async () => {
    const dependencies = createService(8, 8);

    const result = await dependencies.service.apply(
      'user',
      'family:123',
      REQUEST,
    );

    expect(result).toMatchObject({
      success: true,
      status: 'SUCCESS',
      totalItems: 8,
      successfulItems: 8,
      failedItems: 0,
    });
    expect(dependencies.executor.apply).toHaveBeenCalledTimes(8);
  });

  it('bloquea toda escritura cuando el preflight sólo permite 6/8', async () => {
    const dependencies = createService(8, 6);

    await expect(
      dependencies.service.apply('user', 'family:123', REQUEST),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS',
        totalItems: 8,
        applicableItems: 6,
        unavailableItems: 2,
      },
    });
    expect(dependencies.executor.apply).not.toHaveBeenCalled();
  });

  it('también bloquea una eliminación FAMILY incompatible antes de escribir', async () => {
    const dependencies = createService(8, 6);

    await expect(
      dependencies.service.remove('user', 'family:123'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROMOTION_NOT_AVAILABLE_FOR_ALL_ITEMS' },
    });
    expect(dependencies.executor.remove).not.toHaveBeenCalled();
  });

  it('devuelve los MLA afectados y nunca declara success ante un parcial', async () => {
    const dependencies = createService(3, 3);
    dependencies.executor.apply
      .mockResolvedValueOnce(success('MLA1'))
      .mockResolvedValueOnce({
        itemId: 'MLA2',
        success: false,
        stage: 'APPLICATION',
        errorCode: 'PROMOTION_APPLICATION_FAILED',
      })
      .mockResolvedValueOnce(success('MLA3'));

    const result = await dependencies.service.apply(
      'user',
      'family:123',
      REQUEST,
    );

    expect(result).toMatchObject({
      success: false,
      status: 'PARTIAL_FAILURE',
      errorCode: 'PROMOTION_PARTIAL_FAILURE',
      totalItems: 3,
      successfulItems: 2,
      failedItems: 1,
    });
    expect(result.results.find((item) => !item.success)).toEqual({
      itemId: 'MLA2',
      success: false,
      stage: 'APPLICATION',
      errorCode: 'PROMOTION_APPLICATION_FAILED',
    });
  });

  it('declara failure y conserva el error real cuando falla el unico MLA', async () => {
    const dependencies = createService(1, 1);
    dependencies.executor.apply.mockResolvedValueOnce({
      itemId: 'MLA1',
      success: false,
      stage: 'APPLICATION',
      errorCode: 'PROMOTION_APPLICATION_FAILED',
    });

    const result = await dependencies.service.apply(
      'user',
      'item:MLA1',
      REQUEST,
    );

    expect(result).toEqual({
      success: false,
      status: 'FAILURE',
      errorCode: 'PROMOTION_APPLICATION_FAILED',
      totalItems: 1,
      successfulItems: 0,
      failedItems: 1,
      results: [
        {
          itemId: 'MLA1',
          success: false,
          stage: 'APPLICATION',
          errorCode: 'PROMOTION_APPLICATION_FAILED',
        },
      ],
    });
  });

  it('declara failure cuando fallan varios MLA y usa el primer error real', async () => {
    const dependencies = createService(3, 3);
    dependencies.executor.apply
      .mockResolvedValueOnce({
        itemId: 'MLA1',
        success: false,
        stage: 'APPLICATION_VERIFICATION',
        errorCode: 'PROMOTION_VERIFICATION_FAILED',
      })
      .mockResolvedValueOnce({
        itemId: 'MLA2',
        success: false,
        stage: 'APPLICATION',
        errorCode: 'PROMOTION_APPLICATION_FAILED',
      })
      .mockResolvedValueOnce({
        itemId: 'MLA3',
        success: false,
        stage: 'APPLICATION',
      });

    const result = await dependencies.service.apply(
      'user',
      'family:123',
      REQUEST,
    );

    expect(result).toMatchObject({
      success: false,
      status: 'FAILURE',
      errorCode: 'PROMOTION_VERIFICATION_FAILED',
      totalItems: 3,
      successfulItems: 0,
      failedItems: 3,
    });
  });

  it('limita las escrituras FAMILY a tres MLA simultáneos', async () => {
    const dependencies = createService(8, 8);
    let active = 0;
    let maximum = 0;
    dependencies.executor.apply.mockImplementation(
      async (context: PromotionExecutionContext) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return success(context.resolvedItem.item.id);
      },
    );

    await dependencies.service.apply('user', 'family:123', REQUEST);

    expect(maximum).toBe(3);
  });
});

function createService(totalItems: number, applicableItems: number) {
  const source = {
    sourceKey: 'family:123',
    accessToken: 'token',
    items: Array.from({ length: totalItems }, (_, index) => ({
      item: { id: `MLA${index + 1}`, family_id: 123 },
      publication: {
        type: 'NEW' as const,
        familyId: '123',
        itemId: `MLA${index + 1}`,
      },
    })),
  };
  const sourceService = { resolve: jest.fn().mockResolvedValue(source) };
  const preflightService = {
    preview: jest.fn().mockResolvedValue({
      sourceKey: source.sourceKey,
      totalItems,
      applicableItems,
      unavailableItems: totalItems - applicableItems,
      items: [],
    }),
  };
  const executor = {
    apply: jest
      .fn()
      .mockImplementation((context: PromotionExecutionContext) =>
        Promise.resolve(success(context.resolvedItem.item.id)),
      ),
    remove: jest.fn(),
  };
  return {
    service: new PublicationPromotionService(
      sourceService as unknown as PublicationPromotionSourceService,
      preflightService as unknown as PublicationPromotionPreflightService,
      executor as unknown as PublicationPromotionExecutorService,
    ),
    sourceService,
    preflightService,
    executor,
  };
}

function success(itemId: string) {
  return { itemId, success: true, stage: 'COMPLETED' as const };
}
