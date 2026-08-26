import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type {
  PromotionCatalogQuery,
  PromotionCatalogStatus,
} from './promotions-catalog.types';

export enum PromotionCatalogStatusDto {
  ACTIVE = 'ACTIVE',
  AVAILABLE = 'AVAILABLE',
  PENDING = 'PENDING',
  NONE = 'NONE',
}

export class PromotionFacetFilterDto {
  @Transform(({ value }: TransformFnParams) => trimString(value as unknown))
  @IsString()
  @IsNotEmpty()
  attributeId!: string;

  @Transform(({ value }: TransformFnParams) => trimString(value as unknown))
  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class PromotionsCatalogQueryDto implements PromotionCatalogQuery {
  @Transform(({ value }: TransformFnParams) => parseLimit(value as unknown))
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 20;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => trimString(value as unknown))
  @IsString()
  @IsNotEmpty()
  categoryId?: string;

  @IsOptional()
  @IsEnum(PromotionCatalogStatusDto)
  promotionStatus?: PromotionCatalogStatus;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => trimString(value as unknown))
  @IsString()
  @IsNotEmpty()
  promotionType?: string;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseFacetFilters(value))
  @IsArray()
  @ValidateNested({ each: true })
  facetFilters?: PromotionFacetFilterDto[];
}

function parseLimit(value: unknown): unknown {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return value;
  return Number(value);
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseFacetFilters(value: unknown): unknown {
  const parsed = parseJsonArray(value);
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((entry: unknown) => {
    if (!isObject(entry)) return entry;
    const filter = new PromotionFacetFilterDto();
    filter.attributeId = trimString(entry.attributeId) as string;
    filter.value = trimString(entry.value) as string;
    return filter;
  });
}

function parseJsonArray(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
