import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreController } from './mercadolibre.controller';
import { PublicationsService } from './publications/publications.service';

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

type PublicationsMock = jest.Mocked<
  Pick<PublicationsService, 'getPublicationsPage' | 'getPublication'>
>;

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let authService: AuthMock;
  let publicationsService: PublicationsMock;

  beforeEach(() => {
    authService = {
      createAuthorizationUrl: jest.fn(),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      saveTokens: jest.fn(),
    };
    publicationsService = {
      getPublicationsPage: jest.fn(),
      getPublication: jest.fn(),
    };
    controller = new MercadolibreController(
      authService as unknown as MercadolibreAuthService,
      publicationsService as unknown as PublicationsService,
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

    const result = await controller.callback(
      'authorization-code',
      'valid-state',
    );

    expect(authService.verifyState).toHaveBeenCalledWith('valid-state');
    expect(authService.exchangeCode).toHaveBeenCalledWith('authorization-code');
    expect(authService.getCurrentUser).toHaveBeenCalledWith(
      'private-access-token',
    );
    expect(authService.saveTokens).toHaveBeenCalledWith(seller, tokens);
    expect(result).toEqual({
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    });
    expect(JSON.stringify(result)).not.toContain('private-access-token');
    expect(JSON.stringify(result)).not.toContain('private-refresh-token');
  });

  it('delega la paginación como números', async () => {
    const result = {
      paging: { page: 2, limit: 20, total: 35, totalPages: 2 },
      totalItems: 100,
      count: 15,
      publications: [],
      errors: [],
    };
    publicationsService.getPublicationsPage.mockResolvedValue(result);

    await expect(controller.getPublications('2', '20')).resolves.toBe(result);
    expect(publicationsService.getPublicationsPage).toHaveBeenCalledWith(2, 20);
  });

  it('usa página 1 y límite 20 por defecto', async () => {
    const result = {
      paging: { page: 1, limit: 20, total: 0, totalPages: 0 },
      totalItems: 0,
      count: 0,
      publications: [],
      errors: [],
    };
    publicationsService.getPublicationsPage.mockResolvedValue(result);

    await expect(controller.getPublications()).resolves.toBe(result);
    expect(publicationsService.getPublicationsPage).toHaveBeenCalledWith(1, 20);
  });

  it('delega el detalle de una publicación', async () => {
    const item = { id: 'MLA123', title: 'Producto' };
    publicationsService.getPublication.mockResolvedValue(item);

    await expect(controller.getPublication('MLA123')).resolves.toBe(item);
    expect(publicationsService.getPublication).toHaveBeenCalledWith('MLA123');
  });

  it('rechaza state inválido, error del proveedor o código ausente', async () => {
    authService.verifyState.mockReturnValueOnce(false);
    await expect(
      controller.callback(undefined, 'invalid-state', 'access_denied'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    authService.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state', 'access_denied'),
    ).rejects.toBeInstanceOf(BadRequestException);

    authService.verifyState.mockReturnValueOnce(true);
    await expect(
      controller.callback(undefined, 'valid-state'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authService.exchangeCode).not.toHaveBeenCalled();
  });

  it('confirma el webhook sin procesarlo', () => {
    expect(controller.webhook()).toEqual({ ok: true });
  });
});
