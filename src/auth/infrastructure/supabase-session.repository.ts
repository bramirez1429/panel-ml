import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../../database/database.types';
import { SupabaseService } from '../../database/supabase.service';
import {
  CreateSessionInput,
  SessionRepository,
} from '../application/ports/session-repository.port';
import { UserSession } from '../domain/auth.models';

type SessionRow = Database['public']['Tables']['user_sessions']['Row'];

const SESSION_COLUMNS =
  'id,user_id,token_hash,expires_at,revoked_at,created_at';

@Injectable()
export class SupabaseSessionRepository extends SessionRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async create(input: CreateSessionInput): Promise<UserSession> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('user_sessions')
      .insert({
        user_id: input.userId,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt.toISOString(),
        created_at: input.createdAt.toISOString(),
      })
      .select(SESSION_COLUMNS)
      .single();

    if (error || !data) this.writeError();
    return this.mapSession(data);
  }

  async findByTokenHash(tokenHash: string): Promise<UserSession | null> {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('user_sessions')
      .select(SESSION_COLUMNS)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error) this.readError();
    return data ? this.mapSession(data) : null;
  }

  async revoke(sessionId: string, revokedAt: Date): Promise<void> {
    const { error } = await this.supabaseService
      .getClient()
      .from('user_sessions')
      .update({ revoked_at: revokedAt.toISOString() })
      .eq('id', sessionId)
      .is('revoked_at', null);

    if (error) this.writeError();
  }

  private mapSession(row: SessionRow): UserSession {
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: new Date(row.expires_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      createdAt: new Date(row.created_at),
    };
  }

  private readError(): never {
    throw new ServiceUnavailableException('No se pudo leer la sesi\u00f3n');
  }

  private writeError(): never {
    throw new ServiceUnavailableException('No se pudo guardar la sesi\u00f3n');
  }
}
