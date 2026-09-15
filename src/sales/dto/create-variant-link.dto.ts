import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateVariantLinkDto {
  @IsString()
  @Matches(/^MLA\d+$/)
  mlItemId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  mlVariationId?: string;

  @IsString()
  @Matches(/^[1-9]\d*$/)
  tnProductId!: string;

  @IsString()
  @Matches(/^[1-9]\d*$/)
  tnVariantId!: string;
}
