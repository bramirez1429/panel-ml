import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import {
  normalizeEmail,
  SafeUser,
  User,
  UserSession,
} from '../domain/auth.models';
import { PasswordHasher } from './ports/password-hasher.port';
import { SessionRepository } from './ports/session-repository.port';
import { UserRepository } from './ports/user-repository.port';

const SESSION_TTL_MS = 86_400_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type RegisterInput = {
  email: string;
  password: string;
  name?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type LoginResult = {
  user: SafeUser;
  token: string;
  expiresAt: Date;
};

export type AuthenticatedSession = {
  user: SafeUser;
  sessionId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async register(input: RegisterInput): Promise<SafeUser> {
    const passwordHash = await this.passwordHasher.hash(input.password);

    try {
      const user = await this.users.create({
        email: normalizeEmail(input.email),
        passwordHash,
        name: input.name?.trim() ?? null,
      });
      return this.toSafeUser(user);
    } catch (error) {
      if (error instanceof EmailAlreadyExistsError) {
        throw new ConflictException('El email ya est\u00e1 registrado');
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.users.findByEmail(normalizeEmail(input.email));

    if (!user) {
      await this.passwordHasher.hash(input.password);
      this.invalidCredentials();
    }

    const passwordIsValid = await this.passwordHasher.verify(
      input.password,
      user.passwordHash,
    );
    if (!user.isActive || !passwordIsValid) this.invalidCredentials();

    const token = randomBytes(32).toString('base64url');
    const createdAt = new Date();
    const session = await this.sessions.create({
      userId: user.id,
      tokenHash: this.hashSessionToken(token),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
    });

    return {
      user: this.toSafeUser(user),
      token,
      expiresAt: session.expiresAt,
    };
  }

  async authenticateSession(token: string): Promise<AuthenticatedSession> {
    if (!SESSION_TOKEN_PATTERN.test(token)) this.invalidSession();

    const session = await this.sessions.findByTokenHash(
      this.hashSessionToken(token),
    );
    if (!this.isUsableSession(session)) this.invalidSession();

    const user = await this.users.findById(session.userId);
    if (!user?.isActive) this.invalidSession();

    return { user: this.toSafeUser(user), sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, new Date());
  }

  private hashSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isUsableSession(session: UserSession | null): session is UserSession {
    return (
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > Date.now()
    );
  }

  private toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private invalidCredentials(): never {
    throw new UnauthorizedException('Credenciales inv\u00e1lidas');
  }

  private invalidSession(): never {
    throw new UnauthorizedException('Sesi\u00f3n inv\u00e1lida o vencida');
  }
}
