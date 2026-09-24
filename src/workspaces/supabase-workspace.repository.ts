import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { SupabaseService } from '../database/supabase.service';
import { Workspace, WorkspaceRepository } from './workspace.repository';

@Injectable()
export class SupabaseWorkspaceRepository extends WorkspaceRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async findWorkspaceByUserId(userId: string): Promise<Workspace> {
    const membership = await this.readMembership(userId);
    if (!membership) {
      throw new ForbiddenException('El usuario no pertenece a un workspace');
    }

    const workspace = await this.readWorkspace(membership.workspace_id);
    if (!workspace) this.readError();

    return workspace;
  }

  private async readMembership(userId: string) {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) this.readError();
      return data;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      this.readError();
    }
  }

  private async readWorkspace(workspaceId: string) {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('workspaces')
        .select('id,slug,name')
        .eq('id', workspaceId)
        .maybeSingle();
      if (error) this.readError();
      return data;
    } catch {
      this.readError();
    }
  }

  private readError(): never {
    throw new ServiceUnavailableException('No se pudo resolver el workspace');
  }
}
