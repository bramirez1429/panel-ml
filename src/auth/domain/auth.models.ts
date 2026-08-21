export type User = {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SafeUser = Omit<User, 'passwordHash'>;

export type RefreshSession = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  rotatedAt: Date;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
