import type { CookieOptions } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'panel_ml_refresh_token';

const REFRESH_TOKEN_COOKIE_PATH = '/auth';

function refreshTokenCookieScope(): CookieOptions {
  const secure = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: REFRESH_TOKEN_COOKIE_PATH,
  };
}

/** Mantiene el refresh fuera del alcance de JavaScript del navegador. */
export function refreshTokenCookieOptions(expiresAt: Date): CookieOptions {
  return {
    ...refreshTokenCookieScope(),
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  };
}

/** Usa los mismos atributos al eliminar la cookie. */
export function clearRefreshTokenCookieOptions(): CookieOptions {
  return refreshTokenCookieScope();
}

/** Lee únicamente la cookie de refresh sin incorporar un parser global. */
export function readRefreshTokenCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    if (name !== REFRESH_TOKEN_COOKIE_NAME) continue;

    const value = cookie.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}
