import { UserSession } from '../../domain/auth.models';

export type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
};

export abstract class SessionRepository {
  abstract create(input: CreateSessionInput): Promise<UserSession>;
  abstract findByTokenHash(tokenHash: string): Promise<UserSession | null>;
  abstract revoke(sessionId: string, revokedAt: Date): Promise<void>;
}
