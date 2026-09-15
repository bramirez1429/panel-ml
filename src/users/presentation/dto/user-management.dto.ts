import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ASSIGNABLE_USER_ROLES,
  type AssignableUserRole,
} from '../../domain/user-access';

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
  @IsIn([...ASSIGNABLE_USER_ROLES])
  role?: AssignableUserRole;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateUserRoleDto {
  @IsIn([...ASSIGNABLE_USER_ROLES])
  role!: AssignableUserRole;
}

