import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedSession, AuthService } from '../application/auth.service';
import { SessionAuthGuard } from './session-auth.guard';

type AuthServiceMock = jest.Mocked<Pick<AuthService, 'authenticateSession'>>;

type TestRequest = {
  headers: { authorization?: string };
  auth?: AuthenticatedSession;
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

describe('SessionAuthGuard', () => {
  let authService: AuthServiceMock;
  let guard: SessionAuthGuard;

  beforeEach(() => {
    authService = { authenticateSession: jest.fn() };
    guard = new SessionAuthGuard(authService as unknown as AuthService);
  });

  it('delega un Bearer válido y adjunta la sesión autenticada', async () => {
    const token = 'a'.repeat(43);
    const auth: AuthenticatedSession = {
      sessionId: 'session-id',
      user: {
        id: 'user-id',
        email: 'user@example.com',
        name: 'User',
        isActive: true,
        createdAt: new Date('2026-08-21T12:00:00.000Z'),
        updatedAt: new Date('2026-08-21T12:00:00.000Z'),
      },
    };
    authService.authenticateSession.mockResolvedValue(auth);
    const { context, request } = createContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authService.authenticateSession).toHaveBeenCalledWith(token);
    expect(request.auth).toBe(auth);
  });

  it.each([
    ['header ausente', undefined],
    ['esquema incorrecto', `Basic ${'a'.repeat(43)}`],
    ['token malformado', 'Bearer corto'],
  ])('rechaza %s sin consultar el servicio', async (_case, authorization) => {
    const { context } = createContext(authorization);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authService.authenticateSession).not.toHaveBeenCalled();
  });
});
