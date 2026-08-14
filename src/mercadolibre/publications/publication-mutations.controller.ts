import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PublicationAttributesService } from './mutations/publication-attributes.service';
import { PublicationDescriptionService } from './mutations/publication-description.service';
import type { UploadedPictureFile } from './mutations/publication-management.types';
import { PublicationPicturesService } from './mutations/publication-pictures.service';
import { PublicationPriceService } from './mutations/publication-price.service';
import { PublicationSkuService } from './mutations/publication-sku.service';
import { PublicationStatusService } from './mutations/publication-status.service';
import { PublicationStockService } from './mutations/publication-stock.service';
import { PublicationTitleService } from './mutations/publication-title.service';

@Controller('mercadolibre/publicaciones')
export class PublicationMutationsController {
  /** Recibe las mutaciones sobre publicaciones existentes. */
  constructor(
    private readonly priceService: PublicationPriceService,
    private readonly stockService: PublicationStockService,
    private readonly statusService: PublicationStatusService,
    private readonly skuService: PublicationSkuService,
    private readonly picturesService: PublicationPicturesService,
    private readonly titleService: PublicationTitleService,
    private readonly descriptionService: PublicationDescriptionService,
    private readonly attributesService: PublicationAttributesService,
  ) {}

  /** Cambia el título cuando Mercado Libre lo permite. */
  @Patch(':productId/title')
  updateTitle(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.titleService.update(productId, body);
  }

  /** Crea o reemplaza la descripción oficial del MLA seleccionado. */
  @Patch(':productId/description')
  updateDescription(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.descriptionService.update(productId, body);
  }

  /** Fusiona atributos editables y preserva el resto del item. */
  @Patch(':productId/attributes')
  updateAttributes(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.attributesService.update(productId, body);
  }

  /** Actualiza el precio y refresca el snapshot afectado. */
  @Patch(':productId/precio')
  updatePrice(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.priceService.update(productId, body);
  }

  /** Actualiza el stock y refresca el snapshot afectado. */
  @Patch(':productId/stock')
  updateStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.stockService.update(productId, body);
  }

  /** Pausa o activa una condición de venta concreta. */
  @Patch(':productId/status')
  updateStatus(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.statusService.update(productId, body);
  }

  /** Actualiza SELLER_SKU sin perder atributos de la variante. */
  @Patch(':productId/sku')
  updateSku(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ) {
    return this.skuService.update(productId, body);
  }

  /** Administra imágenes mediante el contrato multipart existente. */
  @Post(':productId/pictures')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  updatePictures(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
    @UploadedFile() file?: UploadedPictureFile,
  ) {
    return this.picturesService.update(productId, body, file);
  }
}
