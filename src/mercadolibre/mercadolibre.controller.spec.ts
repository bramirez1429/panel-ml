import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import type { AuthenticatedRequest } from '../auth/presentation/authenticated-request';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreController } from './mercadolibre.controller';

const USER_A = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  name: 'A',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const USER_B = { ...USER_A, id: '22222222-2222-4222-8222-222222222222' };
const BINDING_A = 'a'.repeat(43);
const BINDING_B = 'b'.repeat(43);
const SESSION_A = '33333333-3333-4333-8333-333333333333';
const COOKIE_A = `mercadolibre_oauth_binding_${'c'.repeat(43)}`;
const COOKIE_B = `mercadolibre_oauth_binding_${'d'.repeat(43)}`;

function controllerMethod(
  name: 'connect' | 'callback',
): (...args: never[]) => unknown {
  const method: unknown = Object.getOwnPropertyDescriptor(
    MercadolibreController.prototype,
    name,
  )?.value;
  if (typeof method !== 'function') throw new Error(`Falta el metodo ${name}`);
  return method as (...args: never[]) => unknown;
}

type AuthMock = jest.Mocked<
  Pick<
    MercadolibreAuthService,
    | 'createAuthorizationRequest'
    | 'getAuthorizationCookieName'
    | 'getCallbackCookiePath'
    | 'verifyState'
    | 'exchangeCode'
    | 'getCurrentUser'
    | 'saveTokens'
  >
>;

describe('MercadolibreController', () => {
  let controller: MercadolibreController;
  let authService: AuthMock;
  let cookie: jest.Mock;
  let clearCookie: jest.Mock;
  let response: Response;

  beforeEach(() => {
    authService = {
      createAuthorizationRequest: jest.fn(),
      getAuthorizationCookieName: jest.fn(),
      getCallbackCookiePath: jest
        .fn()
        .mockReturnValue('/mercadolibre/callback'),
      verifyState: jest.fn(),
      exchangeCode: jest.fn(),
      getCurrentUser: jest.fn(),
      saveTokens: jest.fn(),
    };
    cookie = jest.fn();
    clearCookie = jest.fn();
    response = { cookie, clearCookie } as unknown as Response;
    controller = new MercadolibreController(
      authService as unknown as MercadolibreAuthService,
    );
  });

  it('devuelve la URL de autorización', async () => {
    const url =
      'https://auth.mercadolibre.com.ar/authorization?state=signed-state';
    authService.createAuthorizationRequest.mockResolvedValue({
      url,
      cookieName: COOKIE_A,
      cookiePath: '/mercadolibre/callback',
      browserBinding: BINDING_A,
      secureCookie: true,
    });
    const request = {
      auth: { user: USER_A, refreshSessionId: SESSION_A },
    } as AuthenticatedRequest;

    await expect(
      controller.connect(USER_A, request, response),
    ).resolves.toEqual({ url });
    expect(authService.createAuthorizationRequest).toHaveBeenCalledWith(
      USER_A.id,
      SESSION_A,
    );
    expect(cookie).toHaveBeenCalledWith(
      COOKIE_A,
      BINDING_A,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/mercadolibre/callback',
      }),
    );
  });

  it('protege el inicio de OAuth con el JWT de la aplicacion', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      controllerMethod('connect'),
    ) as unknown[];

    expect(guards).toContain(AccessTokenGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controllerMethod('callback')),
    ).toBeUndefined();
  });

  it('completa OAuth sin devolver tokens', async () => {
    const seller = { id: 123456, nickname: 'TEST_SELLER' };
    const tokens = {
      access_token: 'private-access-token',
      refresh_token: 'private-refresh-token',
      expires_in: 21_600,
      user_id: seller.id,
    };
    authService.getAuthorizationCookieName.mockReturnValue(COOKIE_A);
    authService.verifyState.mockResolvedValue(USER_A.id);
    authService.exchangeCode.mockResolvedValue(tokens);
    authService.getCurrentUser.mockResolvedValue(seller);
    authService.saveTokens.mockResolvedValue(undefined);

    const result = await controller.callback(
      response,
      `${COOKIE_A}=${BINDING_A}`,
      'code',
      'valid-state',
    );

    expect(result).toEqual({
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    });
    expect(JSON.stringify(result)).not.toContain('private-access-token');
    expect(JSON.stringify(result)).not.toContain('private-refresh-token');
    expect(authService.saveTokens).toHaveBeenCalledWith(
      USER_A.id,
      seller,
      tokens,
    );
    expect(authService.verifyState).toHaveBeenCalledWith(
      'valid-state',
      BINDING_A,
    );
    expect(clearCookie).toHaveBeenCalledWith(COOKIE_A, {
      path: '/mercadolibre/callback',
    });
  });

  it('mantiene separados callbacks iniciados por usuarios distintos', async () => {
    const sellerA = { id: 101, nickname: 'SELLER_A' };
    const sellerB = { id: 202, nickname: 'SELLER_B' };
    const tokensA = {
      access_token: 'access-a',
      refresh_token: 'refresh-a',
      expires_in: 21_600,
      user_id: sellerA.id,
    };
    const tokensB = {
      access_token: 'access-b',
      refresh_token: 'refresh-b',
      expires_in: 21_600,
      user_id: sellerB.id,
    };
    authService.getAuthorizationCookieName.mockImplementation((state) =>
      state === 'state-a' ? COOKIE_A : COOKIE_B,
    );
    authService.verifyState
      .mockResolvedValueOnce(USER_A.id)
      .mockResolvedValueOnce(USER_B.id);
    authService.exchangeCode
      .mockResolvedValueOnce(tokensA)
      .mockResolvedValueOnce(tokensB);
    authService.getCurrentUser
      .mockResolvedValueOnce(sellerA)
      .mockResolvedValueOnce(sellerB);

    await controller.callback(
      response,
      `${COOKIE_A}=${BINDING_A}`,
      'code-a',
      'state-a',
    );
    await controller.callback(
      response,
      `${COOKIE_B}=${BINDING_B}`,
      'code-b',
      'state-b',
    );

    expect(authService.saveTokens).toHaveBeenNthCalledWith(
      1,
      USER_A.id,
      sellerA,
      tokensA,
    );
    expect(authService.saveTokens).toHaveBeenNthCalledWith(
      2,
      USER_B.id,
      sellerB,
      tokensB,
    );
    expect(authService.verifyState).toHaveBeenNthCalledWith(
      1,
      'state-a',
      BINDING_A,
    );
    expect(authService.verifyState).toHaveBeenNthCalledWith(
      2,
      'state-b',
      BINDING_B,
    );
  });

  it('rechaza state inválido, error externo y código ausente', async () => {
    authService.getAuthorizationCookieName.mockReturnValue(COOKIE_A);
    authService.verifyState.mockResolvedValueOnce(null);
    await expect(
      controller.callback(
        response,
        `${COOKIE_A}=${BINDING_A}`,
        undefined,
        'invalid',
        'access_denied',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clearCookie).not.toHaveBeenCalled();

    authService.verifyState.mockResolvedValueOnce(USER_A.id);
    await expect(
      controller.callback(
        response,
        `${COOKIE_A}=${BINDING_A}`,
        undefined,
        'valid',
        'access_denied',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    authService.verifyState.mockResolvedValueOnce(USER_A.id);
    await expect(
      controller.callback(
        response,
        `${COOKIE_A}=${BINDING_A}`,
        undefined,
        'valid',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un callback abierto en otro navegador', async () => {
    authService.getAuthorizationCookieName.mockReturnValue(COOKIE_A);
    authService.verifyState.mockResolvedValue(null);

    await expect(
      controller.callback(response, undefined, 'code', 'shared-state'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(authService.verifyState).toHaveBeenCalledWith(
      'shared-state',
      undefined,
    );
    expect(authService.exchangeCode).not.toHaveBeenCalled();
  });
});
