import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class RefreshTokenDto {
  /** Compatibilidad con clientes anteriores; la cookie HttpOnly es preferida. */
  @IsOptional()
  @IsString()
  @Length(43, 43)
  @Matches(/^[A-Za-z0-9_-]+$/)
  refreshToken?: string;
}
