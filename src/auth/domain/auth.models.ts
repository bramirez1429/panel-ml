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

export type UserSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
