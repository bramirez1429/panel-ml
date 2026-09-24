import type { AuthService } from '../../auth/application/auth.service';
import type { SafeUser } from '../../auth/domain/auth.models';
import type { WorkspaceRepository } from '../../workspaces/workspace.repository';
import type { ManagedUser } from '../domain/user-management.models';
import type { UserAdminRepository } from './ports/user-admin.repository';
import { UsersService } from './users.service';

const ACTOR_ID = 'actor-admin';
const NEW_USER_ID = 'new-user';
const SAEL_WORKSPACE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'sael',
  name: 'SAEL',
};

function managedUser(
  id: string,
  email: string,
  role: ManagedUser['role'],
): ManagedUser {
  return {
    id,
    email,
    name: null,
    isActive: true,
    role,
    createdAt: new Date('2026-09-24T12:00:00.000Z'),
    updatedAt: new Date('2026-09-24T12:00:00.000Z'),
  };
}

function safeUser(user: ManagedUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

describe('UsersService create workspace membership', () => {
  it('agrega el usuario creado como MEMBER al workspace del ADMIN actor', async () => {
    const actor = managedUser(ACTOR_ID, 'admin@sael.com', 'ADMIN');
    const created = managedUser(NEW_USER_ID, 'nuevo@sael.com', 'USER');
    const auth = {
      register: jest.fn().mockResolvedValue(safeUser(created)),
    };
    const users = {
      findById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(id === ACTOR_ID ? actor : created),
      ),
      updateRole: jest.fn(),
    };
    const workspaces = {
      findWorkspaceByUserId: jest.fn().mockResolvedValue(SAEL_WORKSPACE),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UsersService(
      auth as unknown as AuthService,
      users as unknown as UserAdminRepository,
      workspaces as unknown as WorkspaceRepository,
    );

    await expect(
      service.create(ACTOR_ID, {
        email: 'nuevo@sael.com',
        password: 'secure-password',
        role: 'USER',
      }),
    ).resolves.toEqual(created);

    expect(workspaces.findWorkspaceByUserId).toHaveBeenCalledWith(ACTOR_ID);
    expect(workspaces.addMember).toHaveBeenCalledWith(
      SAEL_WORKSPACE.id,
      NEW_USER_ID,
      'MEMBER',
    );
    expect(workspaces.findWorkspaceByUserId.mock.invocationCallOrder[0]).toBeLessThan(
      auth.register.mock.invocationCallOrder[0],
    );
    expect(auth.register.mock.invocationCallOrder[0]).toBeLessThan(
      workspaces.addMember.mock.invocationCallOrder[0],
    );
  });

  it('mantiene separado el rol ADMIN del panel y el rol MEMBER del workspace', async () => {
    const actor = managedUser(ACTOR_ID, 'owner@sael.com', 'SUPER_ADMIN');
    const registered = managedUser(NEW_USER_ID, 'nuevo@sael.com', 'USER');
    const promoted = managedUser(NEW_USER_ID, 'nuevo@sael.com', 'ADMIN');
    const auth = {
      register: jest.fn().mockResolvedValue(safeUser(registered)),
    };
    const users = {
      findById: jest.fn().mockResolvedValue(actor),
      updateRole: jest.fn().mockResolvedValue(promoted),
    };
    const workspaces = {
      findWorkspaceByUserId: jest.fn().mockResolvedValue(SAEL_WORKSPACE),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UsersService(
      auth as unknown as AuthService,
      users as unknown as UserAdminRepository,
      workspaces as unknown as WorkspaceRepository,
    );

    await expect(
      service.create(ACTOR_ID, {
        email: 'nuevo@sael.com',
        password: 'secure-password',
        role: 'ADMIN',
      }),
    ).resolves.toEqual(promoted);

    expect(users.updateRole).toHaveBeenCalledWith(NEW_USER_ID, 'ADMIN');
    expect(workspaces.addMember).toHaveBeenCalledWith(
      SAEL_WORKSPACE.id,
      NEW_USER_ID,
      'MEMBER',
    );
  });
});
