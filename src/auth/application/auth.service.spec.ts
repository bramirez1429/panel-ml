import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import { SafeUser, User, UserSession } from '../domain/auth.models';
import { AuthService } from './auth.service';
import { PasswordHasher } from './ports/password-hasher.port';
import { SessionRepository } from './ports/session-repository.port';
import { UserRepository } from './ports/user-repository.port';

type UserRepositoryMock = jest.Mocked<
  Pick<UserRepository, 'create' | 'findByEmail' | 'findById'>
>;

type SessionRepositoryMock = jest.Mocked<
  Pick<SessionRepository, 'create' | 'findByTokenHash' | 'revoke'>
>;

type PasswordHasherMock = jest.Mocked<Pick<PasswordHasher, 'hash' | 'verify'>>;

const NOW = new Date('2030-01-02T03:04:05.000Z');
const SESSION_TTL_MS = 86_400_000;
const VALID_TOKEN = 'a'.repeat(43);

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

function buildSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: 'session-id',
    userId: user.id,
    tokenHash: hashToken(VALID_TOKEN),
    expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS),
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let users: UserRepositoryMock;
  let sessions: SessionRepositoryMock;
  let passwordHasher: PasswordHasherMock;

  beforeEach(() => {
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };
    sessions = {
      create: jest.fn(),
      findByTokenHash: jest.fn(),
      revoke: jest.fn(),
    };
    passwordHasher = {
      hash: jest.fn(),
      verify: jest.fn(),
    };
    service = new AuthService(users, sessions, passwordHasher);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('register', () => {
    it('hashea la contrasena, normaliza los datos y omite el hash al responder', async () => {
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

    it('convierte el conflicto de unicidad de email en HTTP 409', async () => {
      passwordHasher.hash.mockResolvedValue('new-password-hash');
      users.create.mockRejectedValue(new EmailAlreadyExistsError());

      const registration = service.register({
        email: user.email,
        password: 'a-secure-password',
      });

      await expect(registration).rejects.toBeInstanceOf(ConflictException);
      await expect(registration).rejects.toMatchObject({ status: 409 });
    });

    it('propaga errores de infraestructura que no son conflictos de email', async () => {
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
    it('crea una sesion de 24 horas y devuelve el token sin almacenarlo en claro', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      users.findByEmail.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(true);
      sessions.create.mockImplementation((input) =>
        Promise.resolve(
          buildSession({
            userId: input.userId,
            tokenHash: input.tokenHash,
            createdAt: input.createdAt,
            expiresAt: input.expiresAt,
          }),
        ),
      );

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
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessions.create).toHaveBeenCalledWith({
        userId: user.id,
        tokenHash: hashToken(result.token),
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + SESSION_TTL_MS),
      });
      expect(sessions.create.mock.calls[0][0].tokenHash).not.toBe(result.token);
      expect(result.expiresAt).toEqual(
        new Date(NOW.getTime() + SESSION_TTL_MS),
      );
    });

    it('realiza trabajo de hash y devuelve 401 si el email no existe', async () => {
      users.findByEmail.mockResolvedValue(null);
      passwordHasher.hash.mockResolvedValue('dummy-password-hash');

      const login = service.login({
        email: ' Missing@Example.COM ',
        password: 'candidate-password',
      });

      await expect(login).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findByEmail).toHaveBeenCalledWith('missing@example.com');
      expect(passwordHasher.hash).toHaveBeenCalledWith('candidate-password');
      expect(passwordHasher.verify).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it.each<[string, boolean, boolean]>([
      ['la contrasena es incorrecta', true, false],
      ['el usuario esta inactivo', false, true],
    ])(
      'devuelve 401 y no crea sesion cuando %s',
      async (_case, isActive, passwordIsValid) => {
        users.findByEmail.mockResolvedValue({ ...user, isActive });
        passwordHasher.verify.mockResolvedValue(passwordIsValid);

        const login = service.login({
          email: user.email,
          password: 'candidate-password',
        });

        await expect(login).rejects.toBeInstanceOf(UnauthorizedException);
        expect(passwordHasher.verify).toHaveBeenCalledWith(
          'candidate-password',
          user.passwordHash,
        );
        expect(passwordHasher.hash).not.toHaveBeenCalled();
        expect(sessions.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('authenticateSession', () => {
    it('resuelve una sesion vigente de un usuario activo sin exponer hashes', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      const session = buildSession();
      sessions.findByTokenHash.mockResolvedValue(session);
      users.findById.mockResolvedValue(user);

      await expect(service.authenticateSession(VALID_TOKEN)).resolves.toEqual({
        user: safeUser,
        sessionId: session.id,
      });

      expect(sessions.findByTokenHash).toHaveBeenCalledWith(
        hashToken(VALID_TOKEN),
      );
      expect(users.findById).toHaveBeenCalledWith(user.id);
    });

    it.each([
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}+`,
      `Bearer ${VALID_TOKEN}`,
    ])(
      'rechaza el token malformado %p antes de consultar la base',
      async (token) => {
        await expect(service.authenticateSession(token)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(sessions.findByTokenHash).not.toHaveBeenCalled();
        expect(users.findById).not.toHaveBeenCalled();
      },
    );

    it.each<[string, UserSession | null]>([
      ['inexistente', null],
      [
        'revocada',
        buildSession({ revokedAt: new Date(NOW.getTime() - 1_000) }),
      ],
      ['vencida', buildSession({ expiresAt: NOW })],
    ])('rechaza una sesion %s', async (_case, storedSession) => {
      jest.useFakeTimers({ now: NOW.getTime() });
      sessions.findByTokenHash.mockResolvedValue(storedSession);

      await expect(
        service.authenticateSession(VALID_TOKEN),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findById).not.toHaveBeenCalled();
    });

    it.each<[string, User | null]>([
      ['inexistente', null],
      ['inactivo', { ...user, isActive: false }],
    ])(
      'rechaza un usuario %s para una sesion valida',
      async (_case, foundUser) => {
        jest.useFakeTimers({ now: NOW.getTime() });
        sessions.findByTokenHash.mockResolvedValue(buildSession());
        users.findById.mockResolvedValue(foundUser);

        await expect(
          service.authenticateSession(VALID_TOKEN),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      },
    );
  });

  describe('logout', () => {
    it('revoca la sesion con la fecha actual', async () => {
      jest.useFakeTimers({ now: NOW.getTime() });
      sessions.revoke.mockResolvedValue(undefined);

      await expect(service.logout('session-id')).resolves.toBeUndefined();

      expect(sessions.revoke).toHaveBeenCalledWith('session-id', NOW);
    });

    it('propaga errores al revocar la sesion', async () => {
      const repositoryError = new Error('database unavailable');
      sessions.revoke.mockRejectedValue(repositoryError);

      await expect(service.logout('session-id')).rejects.toBe(repositoryError);
    });
  });
});
