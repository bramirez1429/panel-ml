import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import type {
  PromotionCatalogQuery,
  PromotionCatalogStatus,
} from './promotions-catalog.types';
import {
  PromotionProductGroup,
  type PromotionProductGroup as PromotionProductGroupType,
} from './promotions-product-group';

export enum PromotionCatalogStatusDto {
  ACTIVE = 'ACTIVE',
  AVAILABLE = 'AVAILABLE',
  PENDING = 'PENDING',
  NONE = 'NONE',
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
  @IsEnum(PromotionProductGroup)
  productGroup?: PromotionProductGroupType;

  @IsOptional()
  @IsEnum(PromotionCatalogStatusDto)
  promotionStatus?: PromotionCatalogStatus;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => trimString(value as unknown))
  @IsString()
  @IsNotEmpty()
  promotionType?: string;
}

function parseLimit(value: unknown): unknown {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return value;
  return Number(value);
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
