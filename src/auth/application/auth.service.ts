import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { EmailAlreadyExistsError } from '../domain/auth.errors';
import { normalizeEmail } from '../domain/auth.models';
import type { RefreshSession, SafeUser, User } from '../domain/auth.models';
import { AccessTokenProvider } from './ports/access-token-provider.port';
import { AuthConfiguration } from './ports/auth-configuration.port';
import { PasswordHasher } from './ports/password-hasher.port';
import { RefreshSessionRepository } from './ports/refresh-session-repository.port';
import { UserRepository } from './ports/user-repository.port';

const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type RegisterInput = {
  email: string;
  password: string;
  name?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RefreshInput = {
  refreshToken: string;
};

export type AuthTokenPair = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};

export type LoginResult = AuthTokenPair & {
  user: SafeUser;
};

export type RefreshResult = LoginResult;

export type AuthenticatedAccess = {
  user: SafeUser;
  refreshSessionId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshSessions: RefreshSessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly accessTokens: AccessTokenProvider,
    private readonly configuration: AuthConfiguration,
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

    const refreshToken = this.generateRefreshToken();
    const session = await this.refreshSessions.create({
      userId: user.id,
      refreshTokenHash: this.hashRefreshToken(refreshToken),
      sessionTtlMs: this.configuration.refreshSessionTtlMs,
    });

    return this.buildLoginResult(user, session, refreshToken, new Date());
  }

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    if (!REFRESH_TOKEN_PATTERN.test(input.refreshToken)) {
      this.invalidRefreshToken();
    }

    const nextRefreshToken = this.generateRefreshToken();
    const session = await this.refreshSessions.rotate({
      currentRefreshTokenHash: this.hashRefreshToken(input.refreshToken),
      nextRefreshTokenHash: this.hashRefreshToken(nextRefreshToken),
    });
    if (!session) this.invalidRefreshToken();

    const user = await this.users.findById(session.userId);
    const issuedAt = new Date();
    if (!user?.isActive || !this.canIssueAccessToken(session, issuedAt)) {
      await this.refreshSessions.revoke(session.id, issuedAt);
      this.invalidRefreshToken();
    }

    return this.buildLoginResult(user, session, nextRefreshToken, issuedAt);
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedAccess> {
    const verified = await this.accessTokens.verify(token);
    if (!verified) this.invalidAccessToken();

    const user = await this.users.findById(verified.userId);
    if (!user?.isActive) this.invalidAccessToken();

    return {
      user: this.toSafeUser(user),
      refreshSessionId: verified.refreshSessionId,
    };
  }

  async logout(refreshSessionId: string): Promise<void> {
    await this.refreshSessions.revoke(refreshSessionId, new Date());
  }

  private async buildLoginResult(
    user: User,
    session: RefreshSession,
    refreshToken: string,
    issuedAt: Date,
  ): Promise<LoginResult> {
    const accessToken = await this.accessTokens.issue({
      userId: user.id,
      refreshSessionId: session.id,
      issuedAt,
      maximumExpiresAt: session.expiresAt,
    });

    return {
      user: this.toSafeUser(user),
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private canIssueAccessToken(
    session: RefreshSession,
    issuedAt: Date,
  ): boolean {
    return (
      session.revokedAt === null &&
      Math.floor(session.expiresAt.getTime() / 1000) >
        Math.floor(issuedAt.getTime() / 1000)
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

  private invalidAccessToken(): never {
    throw new UnauthorizedException('Access token inv\u00e1lido o vencido');
  }

  private invalidRefreshToken(): never {
    throw new UnauthorizedException('Refresh token inv\u00e1lido o vencido');
  }
}
