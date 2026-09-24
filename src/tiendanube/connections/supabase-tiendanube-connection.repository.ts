import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { SupabaseService } from '../../database/supabase.service';
import { WorkspaceRepository } from '../../workspaces/workspace.repository';
import {
  SaveTiendanubeConnectionInput,
  OwnedTiendanubeConnectionCredentials,
  TiendanubeConnectionCredentials,
  TiendanubeConnectionRepository,
  TiendanubeConnectionSummary,
} from './tiendanube-connection.repository';

@Injectable()
export class SupabaseTiendanubeConnectionRepository extends TiendanubeConnectionRepository {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly workspaceRepository: WorkspaceRepository,
  ) {
    super();
  }

  async saveConnection(input: SaveTiendanubeConnectionInput): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .upsert(
          {
            user_id: input.userId,
            store_id: input.storeId,
            access_token: input.accessToken,
            token_type: input.tokenType,
            scope: input.scope,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id', defaultToNull: false },
        );

      if (!error) return;
    } catch {
      // Los detalles de Supabase pueden contener credenciales y no se propagan.
    }

    this.writeError();
  }

  async findSummaryByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionSummary | null> {
    const workspace =
      await this.workspaceRepository.findWorkspaceByUserId(userId);
    const { data, error } = await this.readSummaryRow(workspace.id);

    if (error) this.readError();
    if (!data) return null;

    return {
      storeId: data.store_id,
      scope: data.scope,
    };
  }

  async findCredentialsByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionCredentials | null> {
    const workspace =
      await this.workspaceRepository.findWorkspaceByUserId(userId);
    const { data, error } = await this.readCredentialsRow(workspace.id);

    if (error) this.readError();
    if (!data) return null;

    return {
      storeId: data.store_id,
      accessToken: data.access_token,
      scope: data.scope,
    };
  }

  async findOwnedCredentialsByUserId(
    userId: string,
  ): Promise<OwnedTiendanubeConnectionCredentials | null> {
    const workspace =
      await this.workspaceRepository.findWorkspaceByUserId(userId);
    const { data, error } = await this.readOwnedCredentialsRow(workspace.id);

    if (error) this.readError();
    if (!data) return null;

    return {
      userId: data.user_id,
      storeId: data.store_id,
      accessToken: data.access_token,
      scope: data.scope,
    };
  }

  async findCredentialsByStoreId(
    storeId: string,
  ): Promise<OwnedTiendanubeConnectionCredentials | null> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .select('user_id,store_id,access_token,scope')
        .eq('store_id', storeId)
        .maybeSingle();
      if (error) this.readError();
      if (!data) return null;
      return {
        userId: data.user_id,
        storeId: data.store_id,
        accessToken: data.access_token,
        scope: data.scope,
      };
    } catch {
      this.readError();
    }
  }

  async deleteByUserId(userId: string): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .delete()
        .eq('user_id', userId);

      if (!error) return;
    } catch {
      // Los detalles de Supabase pueden contener credenciales y no se propagan.
    }

    throw new ServiceUnavailableException(
      'No se pudo eliminar la conexión de Tiendanube',
    );
  }

  async deleteByStoreId(storeId: string): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .delete()
        .eq('store_id', storeId);
      if (!error) return;
    } catch {
      // No propagar detalles sensibles de Supabase.
    }
    throw new ServiceUnavailableException(
      'No se pudo eliminar la conexión de Tiendanube',
    );
  }

  private async readSummaryRow(workspaceId: string) {
    try {
      return await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .select('store_id,scope')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    } catch {
      this.readError();
    }
  }

  private async readCredentialsRow(workspaceId: string) {
    try {
      return await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .select('store_id,access_token,scope')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    } catch {
      this.readError();
    }
  }

  private async readOwnedCredentialsRow(workspaceId: string) {
    try {
      return await this.supabaseService
        .getClient()
        .from('tiendanube_connections')
        .select('user_id,store_id,access_token,scope')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    } catch {
      this.readError();
    }
  }

  private readError(): never {
    throw new ServiceUnavailableException(
      'No se pudo leer la conexión de Tiendanube',
    );
  }

  private writeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo guardar la conexión de Tiendanube',
    );
  }
}
