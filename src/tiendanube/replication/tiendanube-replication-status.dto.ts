import { IsString } from 'class-validator';

export class TiendanubeReplicationStatusQueryDto {
  @IsString()
  productIds!: string;
}
