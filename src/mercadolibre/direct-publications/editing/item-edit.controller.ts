import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { ItemEditService } from './item-edit.service';
import { FamilyEditService } from './family-edit.service';
import { StockEditService } from './stock-edit.service';

import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-edit.types';

import type {
  ClassicStockUpdate,
  NewStockUpdate,
} from './stock-edit.types';

@Controller('mercadolibre/direct/edicion')
export class ItemEditController {
  constructor(
    private readonly itemEditService: ItemEditService,
    private readonly familyEditService: FamilyEditService,
    private readonly stockEditService: StockEditService,
  ) {}

  /** Edita una publicación clásica. */
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

  /** Edita stock de una publicación clásica. */
  @Patch('clasica/:itemId/stock')
  updateClassicStock(
    @Param('itemId') itemId: string,
    @Body() changes: ClassicStockUpdate,
  ) {
    return this.stockEditService.updateClassic(
      itemId,
      changes,
    );
  }

  /** Edita datos compartidos de una publicación nueva. */
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

  /** Edita un MLA de una publicación nueva. */
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

  /** Edita stock de una variante nueva. */
  @Patch('nueva/:familyId/items/:itemId/stock')
  updateNewStock(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: NewStockUpdate,
  ) {
    return this.stockEditService.updateNew(
      familyId,
      itemId,
      changes,
    );
  }

  /** Consulta el estado de una tarea de edición de familia. */
  @Get('nueva/tasks/:taskId')
  getFamilyTaskStatus(
    @Param('taskId') taskId: string,
  ) {
    return this.familyEditService.getTaskStatus(
      taskId,
    );
  }

  /** Consulta stock de publicación clásica. */
@Get('clasica/:itemId/stock')
getClassicStock(
  @Param('itemId') itemId: string,
) {
  return this.stockEditService.getClassicStock(
    itemId,
  );
}

/** Consulta stock de una publicación nueva. */
@Get('nueva/:familyId/items/:itemId/stock')
getNewStock(
  @Param('familyId') familyId: string,
  @Param('itemId') itemId: string,
) {
  return this.stockEditService.getNewStock(
    familyId,
    itemId,
  );
}
}