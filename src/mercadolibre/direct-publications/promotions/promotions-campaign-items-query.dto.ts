import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import type { PromotionCampaignItemsQuery } from './promotions-campaign-items.types';

export class PromotionsCampaignItemsQueryDto implements PromotionCampaignItemsQuery {
  @Transform(({ value }: TransformFnParams) => trimString(value))
  @IsString()
  @IsNotEmpty()
  promotionType!: string;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: TransformFnParams) => parseInteger(value))
  @IsInt()
  @Min(0)
  offset?: number;
}

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function parseInteger(value: unknown): unknown {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return value;
  return Number(value);
}
