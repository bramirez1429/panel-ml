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

/** Valida los precios y fechas de un descuento individual. */
export class UpdatePricingDto {
  @IsDefined()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  listPrice!: number;

  @IsDefined()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  salePrice!: number;

  @IsDefined()
  @IsISO8601({ strict: true })
  startDate!: string;

  @IsDefined()
  @IsISO8601({ strict: true })
  finishDate!: string;

  @IsOptional()
  @IsBoolean()
  confirmPromotionReplace?: boolean;
}
