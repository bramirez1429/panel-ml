import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MercadolibreController } from './mercadolibre.controller';
import { MercadolibreService } from './mercadolibre.service';

type ServiceMock = jest.Mocked<
  Pick<
    MercadolibreService,
    | 'createAuthorizationUrl'
    | 'verifyState'
    | 'exchangeCode'
    | 'getCurrentUser'
    | 'getAllPublications'
  >
>;

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      createAuthorizationUrl: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      getAllPublications: jest.fn(),
    };
    controller = new MercadolibreController(
      service as unknown as MercadolibreService,
    );
  });

  it('returns the authorization URL from connect', () => {
    const url =
      'https://auth.mercadolibre.com.ar/authorization?state=signed-state';
    service.createAuthorizationUrl.mockReturnValue(url);

    expect(controller.connect()).toEqual({ url });
    expect(service.createAuthorizationUrl).toHaveBeenCalledTimes(1);
  });

  it('completes the callback flow and never returns the access token', async () => {
    const seller = { id: 123456, nickname: 'TEST_SELLER' };
    const publicationsResult = {
      totalReported: 2,
      idsRetrieved: 2,
      publicationsRetrieved: 1,
      failed: 1,
      publications: [{ id: 'MLA100', title: 'Test publication' }],
      errors: [
        {
          id: 'MLA200',
          code: 404,
          body: { error: 'not_found' },
        },
      ],
    };
    service.verifyState.mockReturnValue(true);
    service.exchangeCode.mockResolvedValue('private-access-token');
    service.getCurrentUser.mockResolvedValue(seller);
    service.getAllPublications.mockResolvedValue(publicationsResult);

    const result = await controller.callback(
      'authorization-code',
      'valid-state',
    );

    expect(service.verifyState).toHaveBeenCalledWith('valid-state');
    expect(service.exchangeCode).toHaveBeenCalledWith('authorization-code');
    expect(service.getCurrentUser).toHaveBeenCalledWith('private-access-token');
    expect(service.getAllPublications).toHaveBeenCalledWith(
      seller.id,
      'private-access-token',
    );
    expect(result).toEqual({ seller, ...publicationsResult });
    expect(JSON.stringify(result)).not.toContain('private-access-token');
  });

  it('rejects invalid state, provider errors and a missing code before exchange', async () => {
    service.verifyState.mockReturnValueOnce(false);
    await expect(
      controller.callback(
        undefined,
        'invalid-state',
        'access_denied',
        'Denied',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    service.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state', 'access_denied', 'Denied'),
    ).rejects.toBeInstanceOf(BadRequestException);

    service.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.exchangeCode).not.toHaveBeenCalled();
  });

  it('acknowledges webhooks immediately', () => {
    expect(controller.webhook()).toEqual({ ok: true });
  });
});
