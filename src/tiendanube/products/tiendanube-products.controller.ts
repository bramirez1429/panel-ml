import { Controller, Get, Header, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';
import type { TiendanubeProductResponse } from './tiendanube-product.types';
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
}
