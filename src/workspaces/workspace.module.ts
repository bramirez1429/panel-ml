import { Module } from '@nestjs/common';

import { SupabaseService } from '../database/supabase.service';
import { SupabaseWorkspaceRepository } from './supabase-workspace.repository';
import { WorkspaceRepository } from './workspace.repository';

@Module({
  providers: [
    SupabaseService,
    {
      provide: WorkspaceRepository,
      useClass: SupabaseWorkspaceRepository,
    },
  ],
  exports: [WorkspaceRepository],
})
export class WorkspaceModule {}
