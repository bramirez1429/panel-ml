import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { UserRole } from '../../domain/user-management.models';

export class CreateManagedUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'USER'])
  role?: UserRole;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateUserRoleDto {
  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'USER'])
  role!: UserRole;
}

