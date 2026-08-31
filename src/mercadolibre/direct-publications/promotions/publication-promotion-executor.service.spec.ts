import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  Logger,
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
  let loggerWarn: jest.SpyInstance;

  beforeEach(() => {
    loggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('mantiene success si el POST fue 2xx aunque el GET siga en candidate', async () => {
    const dependencies = createExecutor([
      state([], [CANDIDATE]),
      state([], [CANDIDATE]),
      state([], [CANDIDATE]),
    ]);

    const result = await dependencies.service.apply(context());

    expect(result).toEqual({
      itemId: 'MLA1',
      success: true,
      stage: 'COMPLETED',
    });
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
  });

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
      promotionStatus: 'started',
    });
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
    expect(dependencies.application.apply).toHaveBeenCalledWith(
      'user',
      RESOLVED.publication,
      REQUEST,
      { timeoutMs: 30_000 },
    );
  });

  it('confirma pending como scheduled sin exigir started', async () => {
    const pending = { ...ACTIVE, status: 'pending' };
    const dependencies = createExecutor([
      state([], [CANDIDATE]),
      state([], [CANDIDATE]),
      state([], [], [pending]),
    ]);

    const result = await dependencies.service.apply(context());

    expect(result).toMatchObject({
      success: true,
      promotionStatus: 'pending',
    });
  });

  it.each([
    ['pending', [], [{ ...ACTIVE, status: 'pending' }]],
    ['started', [ACTIVE], []],
  ] as const)(
    'es idempotente cuando la promoción ya está %s',
    async (promotionStatus, active, pending) => {
      const dependencies = createExecutor([
        state([...active], [], [...pending]),
      ]);

      const result = await dependencies.service.apply(context());

      expect(result).toMatchObject({ success: true, promotionStatus });
      expect(dependencies.application.apply).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['pending', [], [{ ...ACTIVE, status: 'pending' }]],
    ['started', [ACTIVE], []],
  ] as const)(
    'acepta %s durante candidate revalidation sin hacer POST',
    async (promotionStatus, active, pending) => {
      const dependencies = createExecutor([
        state([], [CANDIDATE]),
        state([...active], [], [...pending]),
      ]);

      const result = await dependencies.service.apply(context());

      expect(result).toMatchObject({ success: true, promotionStatus });
      expect(dependencies.application.apply).not.toHaveBeenCalled();
    },
  );

  it('no confunde un pending de otra promoción con la solicitada', async () => {
    const otherPending = {
      id: 'other',
      type: 'DEAL',
      status: 'pending',
      price: 80,
    };
    const dependencies = createExecutor([
      state([], [CANDIDATE], [otherPending]),
      state([], [CANDIDATE], [otherPending]),
      state([], [CANDIDATE], [otherPending]),
    ]);

    const result = await dependencies.service.apply(context());

    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('promotionStatus');
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
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

  it.each([
    ['pending', [], [{ ...PREVIOUS, status: 'pending' }]],
    ['started', [PREVIOUS], []],
  ] as const)(
    'elimina exactamente una promoción %s',
    async (_status, active, pending) => {
      const selected = active[0] ?? pending[0];
      const dependencies = createExecutor([
        state([...active], [], [...pending]),
        state([], [], []),
      ]);

      const result = await dependencies.service.removeSelected(
        'user',
        'token',
        RESOLVED,
        { type: 'DEAL', promotionId: 'old', offerId: null },
      );

      expect(result.success).toBe(true);
      expect(dependencies.removal.removePromotion).toHaveBeenCalledWith(
        'user',
        RESOLVED.publication,
        selected,
        { timeoutMs: 30_000 },
      );
    },
  );

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

  it('DELETE DEAL 200 termina en success', async () => {
    const dependencies = createExecutor([state([PREVIOUS], []), state([], [])]);

    const result = await dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );

    expect(result).toEqual({
      itemId: 'MLA1',
      success: true,
      stage: 'COMPLETED',
    });
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it('DELETE timeout se reconcilia si la promoción desapareció', async () => {
    const dependencies = createExecutor(
      [state([PREVIOUS], []), state([], [])],
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const result = await dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );

    expect(result.success).toBe(true);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it('DELETE 500 se reconcilia si la promoción desapareció', async () => {
    const dependencies = createExecutor(
      [state([PREVIOUS], []), state([], [])],
      jest.fn().mockRejectedValue(providerError(500, 'delete accepted later')),
    );

    const result = await dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );

    expect(result.success).toBe(true);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it('DELETE 503 reintenta sólo GET hasta confirmar desaparición', async () => {
    jest.useFakeTimers();
    const dependencies = createExecutor(
      [state([PREVIOUS], []), state([PREVIOUS], []), state([], [])],
      jest.fn().mockRejectedValue(providerError(503, 'uncertain delete')),
    );

    const operation = dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );
    await jest.runAllTimersAsync();
    const result = await operation;

    expect(result.success).toBe(true);
    expect(dependencies.promotions.getPromotionsStrict).toHaveBeenCalledTimes(
      3,
    );
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it('DELETE 500 conserva failure y mensaje si sigue activa', async () => {
    jest.useFakeTimers();
    const error = providerError(500, 'promotion could not be removed');
    const dependencies = createExecutor(
      [
        state([PREVIOUS], []),
        state([PREVIOUS], []),
        state([PREVIOUS], []),
        state([PREVIOUS], []),
        state([PREVIOUS], []),
        state([PREVIOUS], []),
      ],
      jest.fn().mockRejectedValue(error),
    );

    const operation = dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );
    await jest.runAllTimersAsync();
    const result = await operation;

    expect(result).toMatchObject({
      success: false,
      stage: 'REMOVAL',
      errorCode: 'PROMOTION_REMOVAL_FAILED',
      providerMessage: 'promotion could not be removed',
      providerStatus: 500,
    });
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith({
      operation: 'promotion.remove',
      itemId: 'MLA1',
      promotionType: 'DEAL',
      promotionId: 'old',
      httpStatus: 500,
      providerMessage: 'promotion could not be removed',
    });
    expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain('token');
  });

  it('considera success aunque permanezca otra promoción activa', async () => {
    const other = { id: 'other', type: 'DEAL', status: 'started' };
    const dependencies = createExecutor(
      [state([PREVIOUS, other], []), state([other], [])],
      jest.fn().mockRejectedValue(providerError(502, 'uncertain delete')),
    );

    const result = await dependencies.service.removeSelected(
      'user',
      'token',
      RESOLVED,
      { type: 'DEAL', promotionId: 'old', offerId: null },
    );

    expect(result.success).toBe(true);
    expect(dependencies.removal.removePromotion).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'SELLER_CAMPAIGN',
      { id: 'campaign', type: 'SELLER_CAMPAIGN', status: 'started' },
      { type: 'SELLER_CAMPAIGN', promotionId: 'campaign', offerId: null },
    ],
    [
      'SMART',
      { id: 'smart', type: 'SMART', ref_id: 'offer', status: 'started' },
      { type: 'SMART', promotionId: 'smart', offerId: 'offer' },
    ],
    [
      'PRICE_DISCOUNT',
      { id: 'discount', type: 'PRICE_DISCOUNT', status: 'started' },
      { type: 'PRICE_DISCOUNT', promotionId: null, offerId: null },
    ],
  ])(
    'mantiene removal específico para %s',
    async (_type, promotion, selection) => {
      const dependencies = createExecutor([
        state([promotion], []),
        state([], []),
      ]);

      const result = await dependencies.service.removeSelected(
        'user',
        'token',
        RESOLVED,
        selection,
      );

      expect(result.success).toBe(true);
      expect(dependencies.removal.removePromotion).toHaveBeenCalledWith(
        'user',
        RESOLVED.publication,
        promotion,
        { timeoutMs: 30_000 },
      );
    },
  );

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

  it('acepta POST timeout cuando GET confirma la promoción PENDING', async () => {
    const pending = { ...ACTIVE, status: 'pending' };
    const dependencies = createExecutor(
      [
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [], [pending]),
      ],
      undefined,
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const result = await dependencies.service.apply(context());

    expect(result).toMatchObject({
      success: true,
      promotionStatus: 'pending',
    });
    expect(dependencies.application.apply).toHaveBeenCalledTimes(1);
  });

  it('no reintenta un write con timeout que no pudo confirmar', async () => {
    jest.useFakeTimers();
    const dependencies = createExecutor(
      [
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
        state([], [CANDIDATE]),
      ],
      undefined,
      jest.fn().mockRejectedValue(new GatewayTimeoutException()),
    );

    const operation = dependencies.service.apply(context());
    await jest.runAllTimersAsync();
    const result = await operation;
    jest.useRealTimers();

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

function state(active: object[], candidates: object[], pending: object[] = []) {
  return {
    active,
    candidates,
    pending,
    all: [...active, ...candidates, ...pending],
  };
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

function providerError(status: number, message: string): HttpException {
  return new HttpException(
    {
      message: 'Mercado Libre no está disponible temporalmente',
      mercadoLibreMessage: message,
      mercadoLibreError: 'provider_error',
      mercadoLibreStatus: status,
    },
    status,
  );
}
