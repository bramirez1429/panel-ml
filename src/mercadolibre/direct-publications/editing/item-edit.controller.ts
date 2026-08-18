import {
  Body,
  Controller,
  Param,
  Patch,
} from '@nestjs/common';

import { ItemEditService } from './item-edit.service';
import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-edit.types'

@Controller('mercadolibre/direct/edicion')
export class ItemEditController {
  constructor(
    private readonly itemEditService: ItemEditService,
  ) {}

  /**
   * Edita una publicación versión clásica / SHARED.
   */
  @Patch('clasica/:itemId')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ClassicItemUpdate,
  ) {
    return this.itemEditService.updateClassic(
      itemId,
      changes,
    );
  }

  /**
   * Edita una condición de venta MLA
   * perteneciente a una publicación nueva.
   */
  @Patch('nueva/:itemId')
  updateVariantPricing(
    @Param('itemId') itemId: string,
    @Body() changes: VariantPricingItemUpdate,
  ) {
    return this.itemEditService.updateVariantPricingItem(
      itemId,
      changes,
    );
  }
}