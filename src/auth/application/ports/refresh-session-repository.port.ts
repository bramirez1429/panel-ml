import type { RefreshSession } from '../../domain/auth.models';

export type CreateRefreshSessionInput = {
  userId: string;
  refreshTokenHash: string;
  sessionTtlMs: number;
};

export type RotateRefreshSessionInput = {
  currentRefreshTokenHash: string;
  nextRefreshTokenHash: string;
};

export abstract class RefreshSessionRepository {
  abstract create(input: CreateRefreshSessionInput): Promise<RefreshSession>;
  abstract rotate(
    input: RotateRefreshSessionInput,
  ): Promise<RefreshSession | null>;
  abstract revoke(id: string, revokedAt: Date): Promise<void>;
}
