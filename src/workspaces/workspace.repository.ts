export type Workspace = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;

export abstract class WorkspaceRepository {
  abstract findWorkspaceByUserId(userId: string): Promise<Workspace>;
  abstract addMember(
    workspaceId: string,
    userId: string,
    role: 'MEMBER',
  ): Promise<void>;
}
