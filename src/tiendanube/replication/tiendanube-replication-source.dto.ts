import {
  ArrayMinSize,
  IsArray,
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
import { Transform, Type, type TransformFnParams } from 'class-transformer';

export enum TiendanubePriceMode {
  KEEP_SOURCE = 'KEEP_SOURCE',
  OVERRIDE = 'OVERRIDE',
}

export enum TiendanubeTagMode {
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

  @IsEnum(TiendanubeTagMode)
  tagMode!: TiendanubeTagMode;

  @ValidateIf(
    (o: TiendanubeReplicationOptionsDto) =>
      o.tagMode === TiendanubeTagMode.OVERRIDE,
  )
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Transform(({ value }: TransformFnParams) => trimTags(value as unknown))
  tags?: string[];
}

function trimTags(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map((tag: unknown) => (typeof tag === 'string' ? tag.trim() : tag))
    : value;
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
