import type { UserRole } from './user-management.models';

export const ASSIGNABLE_USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'USER',
] as const;

export type AssignableUserRole =
  (typeof ASSIGNABLE_USER_ROLES)[number];

export function hasRoleAccess(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  if (role === 'SUPER_ADMIN') return true;

  return allowedRoles.includes(role);
}

export function canManageUser(
  actorRole: UserRole,
  targetRole: UserRole,
): boolean {
  if (actorRole === 'SUPER_ADMIN') {
    return true;
  }

  return (
    actorRole === 'ADMIN' &&
    targetRole === 'USER'
  );
}

export function canAssignRole(
  actorRole: UserRole,
  role: AssignableUserRole,
): boolean {
  if (actorRole === 'SUPER_ADMIN') {
    return true;
  }

  return (
    actorRole === 'ADMIN' &&
    role === 'USER'
  );
}
