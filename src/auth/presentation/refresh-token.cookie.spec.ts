import {
  clearRefreshTokenCookieOptions,
  readRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
  refreshTokenCookieOptions,
} from './refresh-token.cookie';

describe('refresh token cookie', () => {
  const previousNodeEnvironment = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnvironment;
  });

  it('es HttpOnly, host-only y apta para cross-site en producción', () => {
    process.env.NODE_ENV = 'production';
    const expiresAt = new Date(Date.now() + 60_000);

    expect(refreshTokenCookieOptions(expiresAt)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/auth',
      expires: expiresAt,
    });
    expect(refreshTokenCookieOptions(expiresAt)).not.toHaveProperty('domain');
  });

  it('lee sólo la cookie esperada y tolera otras cookies', () => {
    expect(
      readRefreshTokenCookie(
        `other=value; ${REFRESH_TOKEN_COOKIE_NAME}=${'a'.repeat(43)}`,
      ),
    ).toBe('a'.repeat(43));
    expect(readRefreshTokenCookie('other=value')).toBeNull();
  });

  it('conserva los atributos de alcance cuando se elimina', () => {
    process.env.NODE_ENV = 'production';

    expect(clearRefreshTokenCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/auth',
    });
  });
});
