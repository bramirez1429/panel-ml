import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreController } from './mercadolibre.controller';

type AuthMock = jest.Mocked<
  Pick<
    MercadolibreAuthService,
    | 'createAuthorizationUrl'
    | 'verifyState'
    | 'exchangeCode'
    | 'getCurrentUser'
    | 'saveTokens'
  >
>;

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let authService: AuthMock;

  beforeEach(() => {
    authService = {
      createAuthorizationUrl: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      saveTokens: jest.fn(),
    };
    controller = new MercadolibreController(
      authService as unknown as MercadolibreAuthService,
    );
  });

  it('devuelve la URL de autorización', () => {
    const url =
      'https://auth.mercadolibre.com.ar/authorization?state=signed-state';
    authService.createAuthorizationUrl.mockReturnValue(url);
    expect(controller.connect()).toEqual({ url });
  });

  it('completa OAuth sin devolver tokens', async () => {
    const seller = { id: 123456, nickname: 'TEST_SELLER' };
    const tokens = {
      access_token: 'private-access-token',
      refresh_token: 'private-refresh-token',
      expires_in: 21_600,
      user_id: seller.id,
    };
    authService.verifyState.mockReturnValue(true);
    authService.exchangeCode.mockResolvedValue(tokens);
    authService.getCurrentUser.mockResolvedValue(seller);
    authService.saveTokens.mockResolvedValue(undefined);

    const result = await controller.callback('code', 'valid-state');

    expect(result).toEqual({
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    });
    expect(JSON.stringify(result)).not.toContain('private-access-token');
    expect(JSON.stringify(result)).not.toContain('private-refresh-token');
  });

  it('rechaza state inválido, error externo y código ausente', async () => {
    authService.verifyState.mockReturnValueOnce(false);
    await expect(
      controller.callback(undefined, 'invalid', 'access_denied'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    authService.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid', 'access_denied'),
    ).rejects.toBeInstanceOf(BadRequestException);

    authService.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
