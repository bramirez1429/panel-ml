import {
  Body,
  Controller,
  Param,
  Patch,
} from '@nestjs/common';

import { ItemUpdateService } from './item-update.service';

import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-update.types';

@Controller('mercadolibre/direct/edicion')
export class ItemController {
  constructor(
    private readonly itemUpdateService:
      ItemUpdateService,
  ) {}

  /** Edita una publicación clásica. */
  @Patch('clasica/:itemId')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: ClassicItemUpdate,
  ) {
    return this.itemUpdateService.updateClassic(
      itemId,
      changes,
    );
  }

  /** Edita un MLA de una publicación nueva. */
  @Patch('nueva/:familyId/items/:itemId')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: VariantPricingItemUpdate,
  ) {
    return this.itemUpdateService.updateVariantPricingItem(
      familyId,
      itemId,
      changes,
    );
  }
}
