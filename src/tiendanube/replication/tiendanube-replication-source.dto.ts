import { IsNotEmpty, IsString, Matches } from 'class-validator';

export const TIENDANUBE_SOURCE_KEY_PATTERN =
  /^(?:item:MLA\d+|family:[1-9]\d*)$/u;

export class TiendanubeReplicationSourceDto {
  @IsString()
  @IsNotEmpty()
  @Matches(TIENDANUBE_SOURCE_KEY_PATTERN)
  sourceKey!: string;
}

export function isTiendanubeSourceKey(value: string): boolean {
  return TIENDANUBE_SOURCE_KEY_PATTERN.test(value);
}
