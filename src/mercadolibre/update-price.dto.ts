import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsPositive } from 'class-validator';

/** Valida el nuevo precio de una publicación. */
export class UpdatePriceDto {
  @IsDefined()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  price!: number;
}
