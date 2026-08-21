import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../../database/database.types';
import { SupabaseService } from '../../database/supabase.service';
import {
  CreateRefreshSessionInput,
  RefreshSessionRepository,
  RotateRefreshSessionInput,
} from '../application/ports/refresh-session-repository.port';
import type { RefreshSession } from '../domain/auth.models';

type RefreshSessionMetadataRow =
  Database['public']['Functions']['rotate_user_refresh_session']['Returns'][number];

@Injectable()
export class SupabaseRefreshSessionRepository extends RefreshSessionRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async create(input: CreateRefreshSessionInput): Promise<RefreshSession> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('create_user_refresh_session', {
        p_user_id: input.userId,
        p_refresh_token_hash: input.refreshTokenHash,
        p_ttl_milliseconds: input.sessionTtlMs,
      });

    if (error) this.writeError();
    const session = data?.[0];
    if (!session) this.writeError();
    return this.mapSession(session);
  }

  async rotate(
    input: RotateRefreshSessionInput,
  ): Promise<RefreshSession | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .rpc('rotate_user_refresh_session', {
        p_current_refresh_token_hash: input.currentRefreshTokenHash,
        p_next_refresh_token_hash: input.nextRefreshTokenHash,
      });

    if (error) this.writeError();
    const session = data?.[0];
    return session ? this.mapSession(session) : null;
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('user_refresh_sessions')
      .update({ revoked_at: revokedAt.toISOString() })
      .eq('id', id)
      .is('revoked_at', null);

    if (error) this.writeError();
  }

  private mapSession(row: RefreshSessionMetadataRow): RefreshSession {
    return {
      id: row.id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      createdAt: new Date(row.created_at),
      rotatedAt: new Date(row.rotated_at),
    };
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar la sesi\u00f3n de refresh',
    );
  }
}
