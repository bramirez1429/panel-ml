import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfiguration } from '../application/ports/auth-configuration.port';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAXIMUM_REFRESH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MINIMUM_SECRET_BYTES = 32;
const DURATION_PATTERN = /^([1-9]\d*)(ms|s|m|h)$/;

type AuthEnvironmentKey =
  | 'JWT_ACCESS_SECRET'
  | 'JWT_ISSUER'
  | 'JWT_AUDIENCE'
  | 'JWT_ACCESS_TTL'
  | 'AUTH_SESSION_TTL';

const DURATION_FACTORS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
} as const;

@Injectable()
export class EnvironmentAuthConfiguration extends AuthConfiguration {
  readonly jwtAccessSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshSessionTtlMs: number;

  constructor(configService: ConfigService) {
    super();

    this.jwtAccessSecret = getRequiredValue(configService, 'JWT_ACCESS_SECRET');
    this.jwtIssuer = getRequiredValue(configService, 'JWT_ISSUER');
    this.jwtAudience = getRequiredValue(configService, 'JWT_AUDIENCE');

    if (
      Buffer.byteLength(this.jwtAccessSecret, 'utf8') < MINIMUM_SECRET_BYTES
    ) {
      throw new Error('JWT_ACCESS_SECRET debe tener al menos 32 bytes');
    }

    const accessTokenTtlMs = parseDuration(
      'JWT_ACCESS_TTL',
      getRequiredValue(configService, 'JWT_ACCESS_TTL'),
    );
    if (accessTokenTtlMs !== ACCESS_TOKEN_TTL_MS) {
      throw new Error('JWT_ACCESS_TTL debe ser exactamente 15m');
    }
    this.accessTokenTtlSeconds = accessTokenTtlMs / 1000;

    this.refreshSessionTtlMs = parseDuration(
      'AUTH_SESSION_TTL',
      getRequiredValue(configService, 'AUTH_SESSION_TTL'),
    );
    if (this.refreshSessionTtlMs > MAXIMUM_REFRESH_SESSION_TTL_MS) {
      throw new Error('AUTH_SESSION_TTL no puede superar 24h');
    }
  }
}

function getRequiredValue(
  configService: ConfigService,
  key: AuthEnvironmentKey,
): string {
  const value = configService.get<string>(key)?.trim();
  if (!value) throw new Error(`${key} es obligatoria`);
  return value;
}

function parseDuration(key: AuthEnvironmentKey, value: string): number {
  const match = DURATION_PATTERN.exec(value);
  if (!match) throw new Error(`${key} debe ser una duracion positiva valida`);

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_FACTORS;
  const durationMs = amount * DURATION_FACTORS[unit];
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error(`${key} debe ser una duracion positiva valida`);
  }
  return durationMs;
}
