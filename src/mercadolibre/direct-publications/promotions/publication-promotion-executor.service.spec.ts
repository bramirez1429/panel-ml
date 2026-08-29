import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import type { PromotionApplicationService } from './promotion-application.service';
import { PublicationPromotionExecutorService } from './publication-promotion-executor.service';
import type { PromotionRemovalService } from './promotion-removal.service';
import type { PromotionsService } from './promotions.service';

const REQUEST = {
  type: 'DEAL' as const,
  promotionId: 'new',
  dealPrice: 80,
};
const RESOLVED = {
  item: { id: 'MLA1', variations: [{}] },
  publication: { type: 'CLASSIC' as const, itemId: 'MLA1' },
};
const CANDIDATE = {
  id: 'new',
  type: 'DEAL',
  status: 'candidate',
  price: 80,
};
const ACTIVE = { id: 'new', type: 'DEAL', status: 'started', price: 80 };
const PREVIOUS = { id: 'old', type: 'DEAL', status: 'started', price: 90 };

describe('PublicationPromotionExecutorService', () => {
  it('aplica una publicación LEGACY una sola vez y verifica ACTIVE', async () => {
    const dependencies = createExecutor([
      state([], [CANDIDATE]),
      state([], [CANDIDATE]),
      state([ACTIVE], []),
    ]);

    const result = await dependencies.service.apply(context());

    expect(result).toEqual({
      itemId: 'MLA1',
      success: true,
      stage: 'COMPLETED',
    });
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
    expect(dependencies.application.apply).toHaveBeenCalledWith(
      'user',
      RESOLVED.publication,
      REQUEST,
      { timeoutMs: 30_000 },
    );
  });

  it('elimina una promoción LEGACY y verifica el estado final', async () => {
    const dependencies = createExecutor([state([PREVIOUS], []), state([], [])]);

    const result = await dependencies.service.remove('user', 'token', RESOLVED);

    expect(result.success).toBe(true);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledWith(
      'user',
      RESOLVED.publication,
      PREVIOUS,
      { timeoutMs: 30_000 },
    );
  });

  it('considera success una eliminación ya inactiva', async () => {
    const dependencies = createExecutor([state([], [])]);

    const result = await dependencies.service.remove('user', 'token', RESOLVED);

    expect(result).toEqual({
      itemId: 'MLA1',
      success: true,
      stage: 'ALREADY_INACTIVE',
    });
    expect(dependencies.removal.removePromotion).not.toHaveBeenCalled();
  });

  it('elimina primero una promoción activa distinta', async () => {
    const dependencies = createExecutor([
      state([PREVIOUS], [CANDIDATE]),
      state([], [CANDIDATE]),
      state([], [CANDIDATE]),
      state([ACTIVE], []),
    ]);

    const result = await dependencies.service.apply(context());

    expect(result.success).toBe(true);
    expect(
      dependencies.removal.removePromotion.mock.invocationCallOrder[0],
    ).toBeLessThan(
      dependencies.application.apply.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('detecta que la candidate desapareció antes de escribir', async () => {
    const dependencies = createExecutor([state([], [])]);

    const result = await dependencies.service.apply(context());

    expect(result).toMatchObject({
      success: false,
      stage: 'CURRENT_STATE',
      errorCode: 'PROMOTION_CHANGED_DURING_OPERATION',
    });
    expect(dependencies.application.apply).not.toHaveBeenCalled();
    expect(dependencies.removal.removePromotion).not.toHaveBeenCalled();
  });

  it('acepta DELETE timeout cuando GET confirma que fue eliminado', async () => {
    const dependencies = createExecutor(
      [
        state([PREVIOUS], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([ACTIVE], []),
      ],
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const result = await dependencies.service.apply(context());

    expect(result.success).toBe(true);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it('acepta POST timeout cuando GET confirma la promoción ACTIVE', async () => {
    const dependencies = createExecutor(
      [
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([ACTIVE], []),
        state([ACTIVE], []),
      ],
      undefined,
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const result = await dependencies.service.apply(context());

    expect(result.success).toBe(true);
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
  });

  it('no reintenta un write con timeout que no pudo confirmar', async () => {
    const dependencies = createExecutor(
      [state([], [CANDIDATE]), state([], [CANDIDATE]), state([], [CANDIDATE])],
      undefined,
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const result = await dependencies.service.apply(context());

    expect(result).toMatchObject({
      success: false,
      stage: 'APPLICATION',
      errorCode: 'PROMOTION_TIMEOUT',
    });
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
  });

  it('conserva el mensaje seguro del proveedor cuando falla apply', async () => {
    const error = new BadRequestException({
      message: 'La promoción cambió o ya no es aplicable',
      mercadoLibreMessage: 'invalid deal price',
      mercadoLibreError: 'bad_request',
    });
    const dependencies = createExecutor(
      [state([], [CANDIDATE]), state([], [CANDIDATE])],
      undefined,
      jest.fn().mockRejectedValue(error),
    );

    const result = await dependencies.service.apply(context());

    expect(result).toMatchObject({
      itemId: 'MLA1',
      success: false,
      stage: 'APPLICATION',
      providerMessage: 'invalid deal price',
    });
    expect(result).not.toHaveProperty('mercadoLibreError');
  });

  it.each([
    [new UnauthorizedException(), 'PROMOTION_PERMISSION_DENIED'],
    [new ForbiddenException(), 'PROMOTION_PERMISSION_DENIED'],
    [new NotFoundException(), 'PROMOTION_NOT_FOUND'],
    [new HttpException('limited', 429), 'PROMOTION_RATE_LIMITED'],
    [new ServiceUnavailableException(), 'PROMOTION_PROVIDER_UNAVAILABLE'],
  ])('normaliza el error del proveedor sin exponerlo', async (error, code) => {
    const dependencies = createExecutor([]);
    dependencies.promotions.getPromotionsStrict.mockRejectedValueOnce(error);

    const result = await dependencies.service.apply(context());

    expect(result.errorCode).toBe(code);
    expect(result).not.toHaveProperty('error');
  });
});

function context() {
  return {
    userId: 'user',
    accessToken: 'token',
    resolvedItem: RESOLVED,
    request: REQUEST,
  };
}

function state(active: object[], candidates: object[]) {
  return { active, candidates, pending: [], all: [...active, ...candidates] };
}

function createExecutor(
  states: object[],
  remove = jest.fn().mockResolvedValue(undefined),
  apply = jest.fn().mockResolvedValue(undefined),
) {
  const queue = [...states];
  const promotions = {
    getPromotionsStrict: jest.fn().mockImplementation(() => {
      const next = queue.shift();
      if (!next) return Promise.reject(new Error('No mock state left'));
      return Promise.resolve(next);
    }),
  };
  const removal = { removePromotion: remove };
  const application = { apply };
  return {
    service: new PublicationPromotionExecutorService(
      promotions as unknown as PromotionsService,
      removal as unknown as PromotionRemovalService,
      application as unknown as PromotionApplicationService,
    ),
    promotions,
    removal,
    application,
  };
}
