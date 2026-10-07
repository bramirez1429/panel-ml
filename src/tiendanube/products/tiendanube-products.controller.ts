import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type {
  TiendanubeProductByMercadolibreResponse,
  TiendanubeProductResponse,
} from './tiendanube-product.types';
import { TiendanubeProductsService } from './tiendanube-products.service';

@Controller('tiendanube/products')
@UseGuards(AccessTokenGuard)
export class TiendanubeProductsController {
  constructor(private readonly productsService: TiendanubeProductsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: SafeUser,
  ): Promise<readonly TiendanubeProductResponse[]> {
    return this.productsService.listByUserId(user.id);
  }

  @Get('by-ml/:itemId')
  @Header('Cache-Control', 'no-store')
  byMercadolibreItem(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Query('mlVariationId') mlVariationId?: string,
  ): Promise<TiendanubeProductByMercadolibreResponse> {
    return this.productsService.getByMercadolibreItem(
      user.id,
      itemId,
      mlVariationId,
    );
  }
}
