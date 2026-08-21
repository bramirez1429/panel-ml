export abstract class AuthConfiguration {
  abstract readonly jwtAccessSecret: string;
  abstract readonly jwtIssuer: string;
  abstract readonly jwtAudience: string;
  abstract readonly accessTokenTtlSeconds: number;
  abstract readonly refreshSessionTtlMs: number;
}
