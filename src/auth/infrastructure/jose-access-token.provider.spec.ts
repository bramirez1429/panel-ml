import { SignJWT, jwtVerify } from 'jose';
import { AuthConfiguration } from '../application/ports/auth-configuration.port';
import { JoseAccessTokenProvider } from './jose-access-token.provider';

const NOW = new Date('2030-01-02T03:04:05.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const USER_ID = 'user-id';
const REFRESH_SESSION_ID = 'refresh-session-id';
const SECRET = 'a-secure-test-secret-with-32-bytes';

const configuration: AuthConfiguration = {
  jwtAccessSecret: SECRET,
  jwtIssuer: 'panel-ml-api',
  jwtAudience: 'panel-ml',
  accessTokenTtlSeconds: 900,
  refreshSessionTtlMs: 86_400_000,
};

type SignedTokenOptions = {
  subject?: string | null;
  issuer?: string;
  audience?: string;
  issuedAt?: number | null;
  expiresAt?: number | null;
  sid?: string | null;
  type?: string;
  algorithm?: 'HS256' | 'HS512';
};

async function signToken(options: SignedTokenOptions = {}): Promise<string> {
  const payload: { sid?: string } =
    options.sid === null ? {} : { sid: options.sid ?? REFRESH_SESSION_ID };
  let token = new SignJWT(payload).setProtectedHeader({
    alg: options.algorithm ?? 'HS256',
    typ: options.type ?? 'JWT',
  });

  if (options.subject !== null) {
    token = token.setSubject(options.subject ?? USER_ID);
  }
  token = token
    .setIssuer(options.issuer ?? configuration.jwtIssuer)
    .setAudience(options.audience ?? configuration.jwtAudience);
  if (options.issuedAt !== null) {
    token = token.setIssuedAt(options.issuedAt ?? NOW_SECONDS);
  }
  if (options.expiresAt !== null) {
    token = token.setExpirationTime(options.expiresAt ?? NOW_SECONDS + 900);
  }

  return token.sign(Buffer.from(SECRET, 'utf8'));
}

describe('JoseAccessTokenProvider', () => {
  let provider: JoseAccessTokenProvider;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW.getTime() });
    provider = new JoseAccessTokenProvider(configuration);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emite un JWT HS256 con todos los claims requeridos por 15 minutos', async () => {
    const result = await provider.issue({
      userId: USER_ID,
      refreshSessionId: REFRESH_SESSION_ID,
      issuedAt: NOW,
      maximumExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });
    const { payload, protectedHeader } = await jwtVerify(
      result.token,
      Buffer.from(SECRET, 'utf8'),
      {
        algorithms: ['HS256'],
        issuer: configuration.jwtIssuer,
        audience: configuration.jwtAudience,
        typ: 'JWT',
        requiredClaims: ['sub', 'iss', 'aud', 'iat', 'exp', 'sid'],
      },
    );

    expect(protectedHeader).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(payload).toMatchObject({
      sub: USER_ID,
      iss: configuration.jwtIssuer,
      aud: configuration.jwtAudience,
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 900,
      sid: REFRESH_SESSION_ID,
    });
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 15 * 60 * 1000));
  });

  it('limita exp al vencimiento absoluto de la sesion refresh', async () => {
    const maximumExpiresAt = new Date(NOW.getTime() + 5 * 60 * 1000);

    const result = await provider.issue({
      userId: USER_ID,
      refreshSessionId: REFRESH_SESSION_ID,
      issuedAt: NOW,
      maximumExpiresAt,
    });

    expect(result.expiresAt).toEqual(maximumExpiresAt);
  });

  it('no emite un token cuando la sesion refresh ya vencio', async () => {
    await expect(
      provider.issue({
        userId: USER_ID,
        refreshSessionId: REFRESH_SESSION_ID,
        issuedAt: NOW,
        maximumExpiresAt: NOW,
      }),
    ).rejects.toThrow(/vencido/);
  });

  it('verifica un access token valido y devuelve sus identificadores', async () => {
    await expect(provider.verify(await signToken())).resolves.toEqual({
      userId: USER_ID,
      refreshSessionId: REFRESH_SESSION_ID,
    });
  });

  it('rechaza un JWT con la firma alterada', async () => {
    const token = await signToken();
    const parts = token.split('.');
    const signature = parts[2];
    parts[2] = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    await expect(provider.verify(parts.join('.'))).resolves.toBeNull();
  });

  it.each<[string, SignedTokenOptions]>([
    ['vencido', { issuedAt: NOW_SECONDS - 10, expiresAt: NOW_SECONDS - 1 }],
    ['issuer incorrecto', { issuer: 'another-issuer' }],
    ['audience incorrecto', { audience: 'another-audience' }],
    ['typ incorrecto', { type: 'refresh+jwt' }],
    ['algoritmo incorrecto', { algorithm: 'HS512' as const }],
    ['sub ausente', { subject: null }],
    ['iat ausente', { issuedAt: null }],
    ['exp ausente', { expiresAt: null }],
    ['iat futuro', { issuedAt: NOW_SECONDS + 1 }],
    ['vigencia mayor a 15 minutos', { expiresAt: NOW_SECONDS + 901 }],
    ['sid ausente', { sid: null }],
    ['sid vacio', { sid: '' }],
  ])('rechaza un token %s', async (_case, options) => {
    await expect(provider.verify(await signToken(options))).resolves.toBeNull();
  });

  it.each(['', 'not-a-jwt', 'header.payload.signature'])(
    'rechaza el valor malformado %p',
    async (token) => {
      await expect(provider.verify(token)).resolves.toBeNull();
    },
  );
});
