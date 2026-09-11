# Autenticación de la aplicación

La aplicación usa passwords hasheadas con Argon2id, access tokens JWT de corta
duración y refresh tokens rotativos.

## Tokens

- El access token es un JWT `HS256` con `sub`, `iss`, `aud`, `iat`, `exp` y
  `sid`. Dura como máximo 15 minutos y se envía como
  `Authorization: Bearer <accessToken>`.
- El refresh token contiene 256 bits aleatorios. Sólo su hash SHA-256 se guarda
  en `user_refresh_sessions`. El valor se emite además en la cookie
  `panel_ml_refresh_token`, `HttpOnly`, con `Path=/auth`, vencimiento absoluto de
  la sesión, `Secure; SameSite=None` en producción y `SameSite=Lax` en desarrollo.
  No se configura `Domain`, por lo que la cookie queda limitada al host de la API.
- Cada refresh reemplaza atómicamente el hash anterior. El token anterior no se
  puede reutilizar y el vencimiento absoluto de la sesión no cambia.
- La sesión de refresh dura como máximo 24 horas desde el login. El último JWT
  se acorta si fuera a superar ese límite.
- Logout revoca la sesión indicada por el claim firmado `sid`. Un access token
  ya emitido puede seguir siendo válido hasta su vencimiento de 15 minutos.

## Endpoints

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`, usando preferentemente la cookie HttpOnly. El body
  `{ "refreshToken": "..." }` se conserva por compatibilidad.
- `GET /auth/me`, con access JWT
- `POST /auth/logout`, con access JWT

Login y refresh devuelven `accessToken`, `accessTokenExpiresAt`, `refreshToken`
y `refreshTokenExpiresAt`. Los responses que contienen tokens usan
`Cache-Control: no-store`. Login y cada refresh también crean o rotan la cookie
HttpOnly. Para frontend y API en orígenes diferentes, el navegador debe enviar
la solicitud con credenciales; CORS admite credenciales para los orígenes
declarados en `CORS_ORIGINS`.

## Configuración obligatoria

- `JWT_ACCESS_SECRET`: al menos 32 bytes.
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `JWT_ACCESS_TTL=15m`
- `AUTH_SESSION_TTL`: valor positivo de hasta `24h`.

La configuración se valida al construir `AuthModule`; los tokens y credenciales
no deben incluirse en logs.
