import { User } from '../../domain/auth.models';

export type CreateUserInput = {
  email: string;
  passwordHash: string;
  name: string | null;
};

export abstract class UserRepository {
  abstract create(input: CreateUserInput): Promise<User>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findById(id: string): Promise<User | null>;
}
