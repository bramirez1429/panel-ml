import {
  Body,
  Controller,
  Param,
  Patch,
} from '@nestjs/common';

import { ItemEditService } from './item-edit.service';
import { FamilyEditService } from './family-edit.service';

import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-edit.types';

@Controller('mercadolibre/direct/edicion')
export class ItemEditController {
  constructor(
    private readonly itemEditService: ItemEditService,
    private readonly familyEditService: FamilyEditService,
  ) {}

  /** Edita una publicación versión clásica. */
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

  /** Edita una condición de venta de una publicación nueva. */
@Patch('nueva/:familyId/items/:itemId')
updateVariantPricing(
  @Param('familyId') familyId: string,
  @Param('itemId') itemId: string,
  @Body() changes: VariantPricingItemUpdate,
) {
  return this.itemEditService.updateVariantPricingItem(
    familyId,
    itemId,
    changes,
  );
}

  /** Edita datos compartidos de una familia nueva. */
@Patch('nueva/:familyId')
  updateFamily(
    @Param('familyId') familyId: string,
    @Body()
    changes: {
      familyName?: string;
    },
  ) {
    return this.familyEditService.updateFamily(
      familyId,
      changes,
    );
  }
}