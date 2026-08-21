import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import type { RefreshSession, SafeUser, User } from '../domain/auth.models';
import { AuthService } from './auth.service';
import type { AccessTokenProvider } from './ports/access-token-provider.port';
import type { AuthConfiguration } from './ports/auth-configuration.port';
import type { PasswordHasher } from './ports/password-hasher.port';
import type { RefreshSessionRepository } from './ports/refresh-session-repository.port';
import type { UserRepository } from './ports/user-repository.port';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const REFRESH_SESSION_TTL_MS = 86_400_000;
const ACCESS_TOKEN_TTL_MS = 900_000;
const ACCESS_TOKEN = 'signed.access.jwt';
const CURRENT_REFRESH_TOKEN = 'a'.repeat(43);

type MockedPort<T> = jest.Mocked<Pick<T, keyof T>>;

const user: User = {
  id: 'user-id',
  email: 'user@example.com',
  passwordHash: 'stored-password-hash',
  name: 'Test User',
  isActive: true,
  createdAt: new Date('2029-12-01T00:00:00.000Z'),
  updatedAt: new Date('2029-12-02T00:00:00.000Z'),
};

const safeUser: SafeUser = {
  id: user.id,
  email: user.email,
  name: user.name,
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

function buildSession(overrides: Partial<RefreshSession> = {}): RefreshSession {
  return {
    id: 'refresh-session-id',
    userId: user.id,
    expiresAt: new Date(NOW.getTime() + REFRESH_SESSION_TTL_MS),
    revokedAt: null,
    createdAt: NOW,
    rotatedAt: NOW,
    ...overrides,
  };
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let users: MockedPort<UserRepository>;
  let refreshSessions: MockedPort<RefreshSessionRepository>;
  let passwordHasher: MockedPort<PasswordHasher>;
  let accessTokens: MockedPort<AccessTokenProvider>;
  let configuration: AuthConfiguration;

  beforeEach(() => {
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    refreshSessions = {
      create: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn(),
    };
    passwordHasher = {
      hash: jest.fn(),
      verify: jest.fn(),
    };
    accessTokens = {
      issue: jest.fn(),
      verify: jest.fn(),
    };
    configuration = {
      jwtAccessSecret: 'test-secret-with-at-least-32-bytes',
      jwtIssuer: 'test-issuer',
      jwtAudience: 'test-audience',
      accessTokenTtlSeconds: ACCESS_TOKEN_TTL_MS / 1_000,
      refreshSessionTtlMs: REFRESH_SESSION_TTL_MS,
    };
    service = new AuthService(
      users,
      refreshSessions,
      passwordHasher,
      accessTokens,
      configuration,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('register', () => {
    it('hashea la contrasena, normaliza los datos y omite el hash', async () => {
      passwordHasher.hash.mockResolvedValue('new-password-hash');
      users.create.mockResolvedValue(user);

      const result = await service.register({
        email: '  USER@Example.COM ',
        password: 'a-secure-password',
        name: '  Test User  ',
      });

      expect(result).toEqual(safeUser);
      expect(result).not.toHaveProperty('passwordHash');
      expect(passwordHasher.hash).toHaveBeenCalledWith('a-secure-password');
      expect(users.create).toHaveBeenCalledWith({
        email: 'user@example.com',
        passwordHash: 'new-password-hash',
        name: 'Test User',
      });
    });

    it('guarda name como null cuando no fue enviado', async () => {
      passwordHasher.hash.mockResolvedValue('new-password-hash');
      users.create.mockResolvedValue({ ...user, name: null });

      await service.register({
        email: user.email,
        password: 'a-secure-password',
      });

      expect(users.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: null }),
      );
    });

    it('convierte el email duplicado en HTTP 409', async () => {
      passwordHasher.hash.mockResolvedValue('new-password-hash');
      users.create.mockRejectedValue(new EmailAlreadyExistsError());

      await expect(
        service.register({
          email: user.email,
          password: 'a-secure-password',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('propaga errores de infraestructura ajenos al email duplicado', async () => {
      const repositoryError = new Error('database unavailable');
      passwordHasher.hash.mockResolvedValue('new-password-hash');
      users.create.mockRejectedValue(repositoryError);

      await expect(
        service.register({
          email: user.email,
          password: 'a-secure-password',
        }),
      ).rejects.toBe(repositoryError);
    });
  });

  describe('login', () => {
    it('emite JWT y persiste solamente el hash del refresh por el TTL configurado', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const sessionExpiresAt = new Date(NOW.getTime() + REFRESH_SESSION_TTL_MS);
      const accessExpiresAt = new Date(NOW.getTime() + ACCESS_TOKEN_TTL_MS);
      users.findByEmail.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(true);
      refreshSessions.create.mockImplementation((input) =>
        Promise.resolve(
          buildSession({
            userId: input.userId,
            expiresAt: new Date(NOW.getTime() + input.sessionTtlMs),
          }),
        ),
      );
      accessTokens.issue.mockResolvedValue({
        token: ACCESS_TOKEN,
        expiresAt: accessExpiresAt,
      });

      const result = await service.login({
        email: ' USER@EXAMPLE.COM ',
        password: 'correct-password',
      });

      expect(users.findByEmail).toHaveBeenCalledWith(user.email);
      expect(passwordHasher.verify).toHaveBeenCalledWith(
        'correct-password',
        user.passwordHash,
      );
      expect(result.user).toEqual(safeUser);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.accessToken).toBe(ACCESS_TOKEN);
      expect(result.accessTokenExpiresAt).toEqual(accessExpiresAt);
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.refreshTokenExpiresAt).toEqual(sessionExpiresAt);
      expect(refreshSessions.create).toHaveBeenCalledWith({
        userId: user.id,
        refreshTokenHash: hashRefreshToken(result.refreshToken),
        sessionTtlMs: REFRESH_SESSION_TTL_MS,
      });
      expect(refreshSessions.create.mock.calls[0][0]).not.toHaveProperty(
        'refreshToken',
      );
      expect(refreshSessions.create.mock.calls[0][0].refreshTokenHash).not.toBe(
        result.refreshToken,
      );
      expect(accessTokens.issue).toHaveBeenCalledWith({
        userId: user.id,
        refreshSessionId: 'refresh-session-id',
        issuedAt: NOW,
        maximumExpiresAt: sessionExpiresAt,
      });
    });

    it('realiza trabajo Argon2 equivalente y devuelve 401 si el email no existe', async () => {
      users.findByEmail.mockResolvedValue(null);
      passwordHasher.hash.mockResolvedValue('dummy-password-hash');

      await expect(
        service.login({
          email: ' Missing@Example.COM ',
          password: 'candidate-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(users.findByEmail).toHaveBeenCalledWith('missing@example.com');
      expect(passwordHasher.hash).toHaveBeenCalledWith('candidate-password');
      expect(passwordHasher.verify).not.toHaveBeenCalled();
      expect(refreshSessions.create).not.toHaveBeenCalled();
      expect(accessTokens.issue).not.toHaveBeenCalled();
    });

    it.each<[string, boolean, boolean]>([
      ['la contrasena es incorrecta', true, false],
      ['el usuario esta inactivo', false, true],
    ])(
      'devuelve 401 sin emitir tokens cuando %s',
      async (_case, isActive, passwordIsValid) => {
        users.findByEmail.mockResolvedValue({ ...user, isActive });
        passwordHasher.verify.mockResolvedValue(passwordIsValid);

        await expect(
          service.login({
            email: user.email,
            password: 'candidate-password',
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(passwordHasher.verify).toHaveBeenCalledWith(
          'candidate-password',
          user.passwordHash,
        );
        expect(passwordHasher.hash).not.toHaveBeenCalled();
        expect(refreshSessions.create).not.toHaveBeenCalled();
        expect(accessTokens.issue).not.toHaveBeenCalled();
      },
    );
  });

  describe('authenticateAccessToken', () => {
    it('resuelve un JWT valido para un usuario activo sin consultar refresh', async () => {
      accessTokens.verify.mockResolvedValue({
        userId: user.id,
        refreshSessionId: 'refresh-session-id',
      });
      users.findById.mockResolvedValue(user);

      await expect(
        service.authenticateAccessToken(ACCESS_TOKEN),
      ).resolves.toEqual({
        user: safeUser,
        refreshSessionId: 'refresh-session-id',
      });

      expect(accessTokens.verify).toHaveBeenCalledWith(ACCESS_TOKEN);
      expect(users.findById).toHaveBeenCalledWith(user.id);
      expect(refreshSessions.create).not.toHaveBeenCalled();
      expect(refreshSessions.rotate).not.toHaveBeenCalled();
      expect(refreshSessions.revoke).not.toHaveBeenCalled();
    });

    it.each([
      ['invalido', 'tampered.access.jwt'],
      ['vencido', 'expired.access.jwt'],
    ])(
      'rechaza un access token %s sin consultar usuarios ni refresh',
      async (_case, token) => {
        accessTokens.verify.mockResolvedValue(null);

        await expect(
          service.authenticateAccessToken(token),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(accessTokens.verify).toHaveBeenCalledWith(token);
        expect(users.findById).not.toHaveBeenCalled();
        expect(refreshSessions.create).not.toHaveBeenCalled();
        expect(refreshSessions.rotate).not.toHaveBeenCalled();
        expect(refreshSessions.revoke).not.toHaveBeenCalled();
      },
    );

    it.each<[string, User | null]>([
      ['inexistente', null],
      ['inactivo', { ...user, isActive: false }],
    ])(
      'rechaza un usuario %s sin consultar sesiones de refresh',
      async (_case, foundUser) => {
        accessTokens.verify.mockResolvedValue({
          userId: user.id,
          refreshSessionId: 'refresh-session-id',
        });
        users.findById.mockResolvedValue(foundUser);

        await expect(
          service.authenticateAccessToken(ACCESS_TOKEN),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(refreshSessions.create).not.toHaveBeenCalled();
        expect(refreshSessions.rotate).not.toHaveBeenCalled();
        expect(refreshSessions.revoke).not.toHaveBeenCalled();
      },
    );
  });

  describe('refresh', () => {
    it('rota hashes viejo/nuevo y devuelve un nuevo par sin renovar el vencimiento absoluto', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const session = buildSession();
      const accessExpiresAt = new Date(NOW.getTime() + ACCESS_TOKEN_TTL_MS);
      refreshSessions.rotate.mockResolvedValue(session);
      users.findById.mockResolvedValue(user);
      accessTokens.issue.mockResolvedValue({
        token: ACCESS_TOKEN,
        expiresAt: accessExpiresAt,
      });

      const result = await service.refresh({
        refreshToken: CURRENT_REFRESH_TOKEN,
      });

      expect(result.user).toEqual(safeUser);
      expect(result.accessToken).toBe(ACCESS_TOKEN);
      expect(result.accessTokenExpiresAt).toEqual(accessExpiresAt);
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.refreshTokenExpiresAt).toEqual(session.expiresAt);
      expect(refreshSessions.rotate).toHaveBeenCalledWith({
        currentRefreshTokenHash: hashRefreshToken(CURRENT_REFRESH_TOKEN),
        nextRefreshTokenHash: hashRefreshToken(result.refreshToken),
      });
      expect(refreshSessions.create).not.toHaveBeenCalled();
      expect(refreshSessions.revoke).not.toHaveBeenCalled();
      expect(accessTokens.issue).toHaveBeenCalledWith({
        userId: user.id,
        refreshSessionId: session.id,
        issuedAt: NOW,
        maximumExpiresAt: session.expiresAt,
      });
    });

    it('rechaza un refresh malformado antes de consultar persistencia', async () => {
      await expect(
        service.refresh({ refreshToken: 'malformed' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(refreshSessions.rotate).not.toHaveBeenCalled();
      expect(users.findById).not.toHaveBeenCalled();
      expect(accessTokens.issue).not.toHaveBeenCalled();
    });

    it('rechaza el replay cuando la rotacion atomica no encuentra la sesion', async () => {
      refreshSessions.rotate.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: CURRENT_REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(refreshSessions.rotate).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRefreshTokenHash: hashRefreshToken(CURRENT_REFRESH_TOKEN),
        }),
      );
      expect(users.findById).not.toHaveBeenCalled();
      expect(refreshSessions.revoke).not.toHaveBeenCalled();
      expect(accessTokens.issue).not.toHaveBeenCalled();
    });

    it('rechaza reutilizar el refresh anterior despues de una rotacion exitosa', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const session = buildSession();
      let currentTokenIsAvailable = true;
      refreshSessions.rotate.mockImplementation(() => {
        if (!currentTokenIsAvailable) return Promise.resolve(null);
        currentTokenIsAvailable = false;
        return Promise.resolve(session);
      });
      users.findById.mockResolvedValue(user);
      accessTokens.issue.mockResolvedValue({
        token: ACCESS_TOKEN,
        expiresAt: new Date(NOW.getTime() + ACCESS_TOKEN_TTL_MS),
      });

      await expect(
        service.refresh({ refreshToken: CURRENT_REFRESH_TOKEN }),
      ).resolves.toMatchObject({ accessToken: ACCESS_TOKEN });
      await expect(
        service.refresh({ refreshToken: CURRENT_REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(refreshSessions.rotate).toHaveBeenCalledTimes(2);
      expect(accessTokens.issue).toHaveBeenCalledTimes(1);
    });

    it.each<[string, Partial<RefreshSession>]>([
      ['vencida', { expiresAt: NOW }],
      ['revocada', { revokedAt: new Date(NOW.getTime() - 1_000) }],
    ])(
      'rechaza y revoca defensivamente una sesion %s',
      async (_case, state) => {
        jest.useFakeTimers({ now: NOW.getTime() });
        const session = buildSession(state);
        refreshSessions.rotate.mockResolvedValue(session);
        users.findById.mockResolvedValue(user);
        refreshSessions.revoke.mockResolvedValue(undefined);

        await expect(
          service.refresh({ refreshToken: CURRENT_REFRESH_TOKEN }),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(refreshSessions.revoke).toHaveBeenCalledWith(session.id, NOW);
        expect(accessTokens.issue).not.toHaveBeenCalled();
      },
    );

    it('revoca la sesion rotada cuando el usuario esta inactivo', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const session = buildSession();
      refreshSessions.rotate.mockResolvedValue(session);
      users.findById.mockResolvedValue({ ...user, isActive: false });
      refreshSessions.revoke.mockResolvedValue(undefined);

      await expect(
        service.refresh({ refreshToken: CURRENT_REFRESH_TOKEN }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(refreshSessions.revoke).toHaveBeenCalledWith(session.id, NOW);
      expect(accessTokens.issue).not.toHaveBeenCalled();
    });

    it('preserva el limite original de 24 horas y delega el cap del access token', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const absoluteExpiresAt = new Date(NOW.getTime() + 10 * 60_000);
      const session = buildSession({
        createdAt: new Date(absoluteExpiresAt.getTime() - 86_400_000),
        rotatedAt: NOW,
        expiresAt: absoluteExpiresAt,
      });
      refreshSessions.rotate.mockResolvedValue(session);
      users.findById.mockResolvedValue(user);
      accessTokens.issue.mockResolvedValue({
        token: ACCESS_TOKEN,
        expiresAt: absoluteExpiresAt,
      });

      const result = await service.refresh({
        refreshToken: CURRENT_REFRESH_TOKEN,
      });

      expect(result.refreshTokenExpiresAt).toEqual(absoluteExpiresAt);
      expect(result.accessTokenExpiresAt).toEqual(absoluteExpiresAt);
      expect(accessTokens.issue).toHaveBeenCalledWith({
        userId: user.id,
        refreshSessionId: session.id,
        issuedAt: NOW,
        maximumExpiresAt: absoluteExpiresAt,
      });
    });
  });

  describe('logout', () => {
    it('revoca por sid con la fecha actual', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      refreshSessions.revoke.mockResolvedValue(undefined);

      await expect(
        service.logout('refresh-session-id'),
      ).resolves.toBeUndefined();

      expect(refreshSessions.revoke).toHaveBeenCalledWith(
        'refresh-session-id',
        NOW,
      );
    });

    it('propaga errores al revocar', async () => {
      const repositoryError = new Error('database unavailable');
      refreshSessions.revoke.mockRejectedValue(repositoryError);

      await expect(service.logout('refresh-session-id')).rejects.toBe(
        repositoryError,
      );
    });
  });
});
