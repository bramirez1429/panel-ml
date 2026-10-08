import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import type { TiendanubeProductsCatalogQuery } from './tiendanube-product.types';

export class TiendanubeProductsCatalogQueryDto
  implements TiendanubeProductsCatalogQuery
{
  @Transform(({ value }: TransformFnParams) => parsePositiveInteger(value, 1))
  @IsInt()
  @Min(1)
  page = 1;

  @Transform(({ value }: TransformFnParams) => parsePositiveInteger(value, 20))
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 20;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => trimString(value))
  @IsString()
  @IsNotEmpty()
  q?: string;
}

function parsePositiveInteger(value: unknown, fallback: number): unknown {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return value;
  return Number(value);
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
