import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import {
  AccessTokenProvider,
  IssueAccessTokenInput,
  IssuedAccessToken,
  VerifiedAccessToken,
} from '../application/ports/access-token-provider.port';
import { AuthConfiguration } from '../application/ports/auth-configuration.port';

const JWT_ALGORITHM = 'HS256';
const JWT_TYPE = 'JWT';
const REQUIRED_CLAIMS = ['sub', 'iss', 'aud', 'iat', 'exp', 'sid'];

@Injectable()
export class JoseAccessTokenProvider extends AccessTokenProvider {
  private readonly secret: Uint8Array;

  constructor(private readonly configuration: AuthConfiguration) {
    super();
    this.secret = Buffer.from(configuration.jwtAccessSecret, 'utf8');
  }

  async issue(input: IssueAccessTokenInput): Promise<IssuedAccessToken> {
    const issuedAt = toNumericDate(input.issuedAt);
    const maximumExpiresAt = toNumericDate(input.maximumExpiresAt);
    const expiresAt = Math.min(
      issuedAt + this.configuration.accessTokenTtlSeconds,
      maximumExpiresAt,
    );
    if (expiresAt <= issuedAt) {
      throw new Error('No se puede emitir un access token ya vencido');
    }

    const token = await new SignJWT({ sid: input.refreshSessionId })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: JWT_TYPE })
      .setSubject(input.userId)
      .setIssuer(this.configuration.jwtIssuer)
      .setAudience(this.configuration.jwtAudience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.secret);

    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<VerifiedAccessToken | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: [JWT_ALGORITHM],
        typ: JWT_TYPE,
        issuer: this.configuration.jwtIssuer,
        audience: this.configuration.jwtAudience,
        requiredClaims: REQUIRED_CLAIMS,
        maxTokenAge: this.configuration.accessTokenTtlSeconds,
      });

      if (
        typeof payload.sub !== 'string' ||
        payload.sub.length === 0 ||
        typeof payload.sid !== 'string' ||
        payload.sid.length === 0 ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > this.configuration.accessTokenTtlSeconds
      ) {
        return null;
      }

      return {
        userId: payload.sub,
        refreshSessionId: payload.sid,
      };
    } catch {
      return null;
    }
  }
}

function toNumericDate(value: Date): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error('Fecha JWT invalida');
  return Math.floor(milliseconds / 1000);
}
