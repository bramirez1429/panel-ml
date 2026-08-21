import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedAccess } from '../application/auth.service';
import { AuthService } from '../application/auth.service';
import { AccessTokenGuard } from './access-token.guard';

type AuthServiceMock = jest.Mocked<
  Pick<AuthService, 'authenticateAccessToken'>
>;

type TestRequest = {
  headers: { authorization?: string };
  auth?: AuthenticatedAccess;
};

function createContext(authorization?: string): {
  context: ExecutionContext;
  request: TestRequest;
} {
  const request: TestRequest = { headers: {} };
  if (authorization !== undefined) {
    request.headers.authorization = authorization;
  }

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('AccessTokenGuard', () => {
  let authService: AuthServiceMock;
  let guard: AccessTokenGuard;

  beforeEach(() => {
    authService = { authenticateAccessToken: jest.fn() };
    guard = new AccessTokenGuard(authService as unknown as AuthService);
  });

  it('autentica el Bearer JWT y adjunta el principal al request', async () => {
    const token = 'header.payload.signature';
    const auth: AuthenticatedAccess = {
      refreshSessionId: 'session-id',
      user: {
        id: 'user-id',
        email: 'user@example.com',
        name: 'User',
        isActive: true,
        createdAt: new Date('2026-08-21T12:00:00.000Z'),
        updatedAt: new Date('2026-08-21T12:00:00.000Z'),
      },
    };
    authService.authenticateAccessToken.mockResolvedValue(auth);
    const { context, request } = createContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authService.authenticateAccessToken).toHaveBeenCalledWith(token);
    expect(request.auth).toBe(auth);
  });

  it.each([
    ['header ausente', undefined],
    ['esquema incorrecto', 'Basic header.payload.signature'],
    ['token con espacios', 'Bearer header. payload.signature'],
    ['token demasiado largo', `Bearer ${'a'.repeat(4097)}`],
  ])('rechaza %s antes de verificar el JWT', async (_case, authorization) => {
    const { context } = createContext(authorization);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authService.authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('propaga el 401 cuando la firma o los claims no son válidos', async () => {
    authService.authenticateAccessToken.mockRejectedValue(
      new UnauthorizedException('Access token inválido o vencido'),
    );
    const { context } = createContext('Bearer header.payload.signature');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
