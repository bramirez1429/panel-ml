import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum TiendanubePriceMode {
  KEEP_SOURCE = 'KEEP_SOURCE',
  OVERRIDE = 'OVERRIDE',
}

export class TiendanubeReplicationOptionsDto {
  @IsEnum(TiendanubePriceMode)
  priceMode!: TiendanubePriceMode;

  @ValidateIf(
    (o: TiendanubeReplicationOptionsDto) =>
      o.priceMode === TiendanubePriceMode.OVERRIDE,
  )
  @IsNumber()
  @Min(0.000001)
  price?: number;

  @IsInt()
  @Min(1)
  categoryId!: number;
}

export const TIENDANUBE_SOURCE_KEY_PATTERN =
  /^(?:item:MLA\d+|family:[1-9]\d*)$/u;

export class TiendanubeReplicationSourceDto {
  @IsString()
  @IsNotEmpty()
  @Matches(TIENDANUBE_SOURCE_KEY_PATTERN)
  sourceKey!: string;

  @ValidateNested()
  @Type(() => TiendanubeReplicationOptionsDto)
  options!: TiendanubeReplicationOptionsDto;
}

export function isTiendanubeSourceKey(value: string): boolean {
  return TIENDANUBE_SOURCE_KEY_PATTERN.test(value);
}
