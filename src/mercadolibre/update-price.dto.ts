import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

/** Valida el nuevo precio de una publicación. */
export class UpdatePriceDto {
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  price!: number;
}

/** Valida los precios de lista y promoción de una publicación. */
export class UpdatePricingDto {
  @IsDefined()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  listPrice!: number;

  @IsDefined()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  salePrice!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  startDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  finishDate?: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  topDealPrice?: number;

  @IsOptional()
  @IsBoolean()
  confirmPromotionReplace?: boolean;
}
