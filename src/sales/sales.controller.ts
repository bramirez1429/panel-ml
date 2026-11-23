import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { MercadolibreCurveService } from './mercadolibre-curve.service';
import { TiendanubeCurveService } from './tiendanube-curve.service';
import { CreateVariantLinkDto } from './dto/create-variant-link.dto';
import { RecentSalesService } from './recent-sales.service';
import { SalesSyncService } from './sales-sync.service';
import { VariantLinkService } from './variant-link.service';
import { VariantChannelLinksRepository } from './variant-channel-links.repository';

@Controller('sales')
@UseGuards(AccessTokenGuard)
export class SalesController {
  constructor(
    private readonly recentSales: RecentSalesService,
    private readonly variantLinks: VariantLinkService,
    private readonly salesSync: SalesSyncService,
    private readonly storedLinks: VariantChannelLinksRepository,
    private readonly mlSku: MercadolibreCurveService,
    private readonly tnSku: TiendanubeCurveService,
  ) {}

  @Get('recent')
  listRecent(@CurrentUser() user: SafeUser, @Query('hours') hours?: string) {
    return this.recentSales.list(user.id, hours);
  }

  @Get('recent/:saleId/variants')
  detail(@CurrentUser() user: SafeUser, @Param('saleId') saleId: string) {
    return this.recentSales.detail(user.id, saleId);
  }


  @Post('sync')
  sync(
    @CurrentUser() user: SafeUser,
    @Query('hours') hours?: string,
  ) {
    return this.salesSync.sync(user.id, hours);
  }

  /** Vinculaciones persistidas, sólo del usuario autenticado y sin credenciales. */
  @Get('stock-by-sku')
  async findStockBySku(
    @CurrentUser() user: SafeUser,
    @Query('sku') query?: string,
  ) {
    const sku = query?.trim();
    if (!sku || sku.length > 100) {
      throw new BadRequestException('Ingresá un SKU válido de hasta 100 caracteres');
    }
    const [ml, tn] = await Promise.allSettled([
      this.mlSku.findBySku(user.id, sku),
      this.tnSku.findBySku(user.id, sku),
    ]);
    return {
      sku,
      mercadoLibre: ml.status === 'fulfilled'
        ? { variants: ml.value, error: false }
        : { variants: [], error: true },
      tiendanube: tn.status === 'fulfilled'
        ? { variants: tn.value, error: false }
        : { variants: [], error: true },
    };
  }

  @Get('variant-links')
  async listLinks(@CurrentUser() user: SafeUser) {
    const links = await this.storedLinks.findByUserId(user.id);
    return links.map(({ userId, ...link }) => { void userId; return link; });
  }

  @Post('variant-links')
  createLink(
    @CurrentUser() user: SafeUser,
    @Body() input: CreateVariantLinkDto,
  ) {
    return this.variantLinks.create(user.id, input);
  }
}
