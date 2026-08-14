import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PublicationActivityService } from './activity/publication-activity.service';
import { PublicationCapabilitiesService } from './mutations/publication-capabilities.service';
import { PublicationPricesService } from './prices/publication-prices.service';
import { PublicationPromotionsService } from './promotions/publication-promotions.service';

@Controller('mercadolibre/publicaciones')
export class PublicationCommercialController {
  /** Recibe consultas comerciales y comandos de promociones. */
  constructor(
    private readonly pricesService: PublicationPricesService,
    private readonly promotionsService: PublicationPromotionsService,
    private readonly activityService: PublicationActivityService,
    private readonly capabilitiesService: PublicationCapabilitiesService,
  ) {}

  /** Obtiene precios oficiales sin depender de los datos de /items. */
  @Get(':productId/prices')
  getPrices(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('itemId') itemId?: string,
  ) {
    return this.pricesService.get(productId, itemId);
  }

  /** Consulta las promociones asociadas al item seleccionado. */
  @Get(':productId/promotions')
  getPromotions(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('itemId') itemId?: string,
  ) {
    return this.promotionsService.get(productId, itemId);
  }

  /** Lista el historial del producto o de uno de sus hijos. */
  @Get(':productId/activity')
  getActivity(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('itemId') itemId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.activityService.list(productId, itemId, limit);
  }

  /** Expone los controles que Mercado Libre permite para el target. */
  @Get(':productId/capabilities')
  getCapabilities(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('itemId') itemId?: string,
  ) {
    return this.capabilitiesService.get(productId, itemId);
  }

  /** Aplica exclusivamente una promoción PRICE_DISCOUNT. */
  @Post(':productId/promotions/price-discount')
  applyPriceDiscount(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.promotionsService.applyPriceDiscount(productId, body);
  }

  /** Quita PRICE_DISCOUNT sin fabricar acciones para otros tipos. */
  @Delete(':productId/promotions/price-discount')
  removePriceDiscount(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
    @Query('itemId') itemId?: string,
  ) {
    return this.promotionsService.removePriceDiscount(productId, body, itemId);
  }
}
