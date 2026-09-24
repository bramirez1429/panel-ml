import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../database/database.types';
import type { SupabaseService } from '../database/supabase.service';
import { SupabaseWorkspaceRepository } from './supabase-workspace.repository';

const SAEL_WORKSPACE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'sael',
  name: 'SAEL',
};

describe('SupabaseWorkspaceRepository', () => {
  it('resuelve prueba y b.ramireeez al workspace SAEL', async () => {
    const membershipMaybeSingle = jest
      .fn()
      .mockResolvedValue({
        data: { workspace_id: SAEL_WORKSPACE.id },
        error: null,
      });
    const workspaceMaybeSingle = jest
      .fn()
      .mockResolvedValue({ data: SAEL_WORKSPACE, error: null });
    const membershipEq = jest
      .fn()
      .mockReturnValue({ maybeSingle: membershipMaybeSingle });
    const workspaceEq = jest
      .fn()
      .mockReturnValue({ maybeSingle: workspaceMaybeSingle });
    const from = jest.fn((table: string) => ({
      select: jest.fn().mockReturnValue({
        eq: table === 'workspace_members' ? membershipEq : workspaceEq,
      }),
    }));
    const supabase = {
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService;
    const repository = new SupabaseWorkspaceRepository(supabase);

    await expect(repository.findWorkspaceByUserId('prueba')).resolves.toEqual(
      SAEL_WORKSPACE,
    );
    await expect(
      repository.findWorkspaceByUserId('b.ramireeez'),
    ).resolves.toEqual(SAEL_WORKSPACE);
    expect(membershipEq).toHaveBeenCalledWith('user_id', 'prueba');
    expect(membershipEq).toHaveBeenCalledWith('user_id', 'b.ramireeez');
    expect(workspaceEq).toHaveBeenCalledWith('id', SAEL_WORKSPACE.id);
  });

  it('rechaza de forma controlada un usuario sin workspace', async () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const client = { from: jest.fn().mockReturnValue({ select }) } as unknown as
      SupabaseClient<Database>;
    const supabase = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;
    const repository = new SupabaseWorkspaceRepository(supabase);

    await expect(
      repository.findWorkspaceByUserId('unassigned-user'),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('agrega un miembro de forma idempotente', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const supabase = {
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService;
    const repository = new SupabaseWorkspaceRepository(supabase);

    await repository.addMember(SAEL_WORKSPACE.id, 'new-user', 'MEMBER');
    await repository.addMember(SAEL_WORKSPACE.id, 'new-user', 'MEMBER');

    expect(from).toHaveBeenCalledWith('workspace_members');
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(
      {
        workspace_id: SAEL_WORKSPACE.id,
        user_id: 'new-user',
        role: 'MEMBER',
      },
      {
        onConflict: 'workspace_id,user_id',
        ignoreDuplicates: true,
      },
    );
  });
});
