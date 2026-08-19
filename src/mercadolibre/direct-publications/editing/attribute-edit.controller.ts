import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { AttributeEditService } from './attribute-edit.service';

import type {
  AttributeUpdate,
} from './attribute-edit.types';

@Controller('mercadolibre/direct/edicion')
export class AttributeEditController {
  constructor(
    private readonly attributeEditService:
      AttributeEditService,
  ) {}

  @Get('clasica/:itemId/atributos')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.attributeEditService.getClassic(
      itemId,
    );
  }

  @Patch('clasica/:itemId/atributos')
  updateClassicItem(
    @Param('itemId') itemId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributeEditService.updateClassicItemAttribute(
      itemId,
      changes,
    );
  }

  @Patch(
    'clasica/:itemId/variaciones/:variationId/atributos',
  )
  updateClassicVariationAttribute(
    @Param('itemId') itemId: string,
    @Param('variationId')
    variationId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributeEditService.updateClassicVariationAttribute(
      itemId,
      variationId,
      changes,
    );
  }

  @Patch(
    'clasica/:itemId/variaciones/:variationId/combinacion',
  )
  updateClassicCombination(
    @Param('itemId') itemId: string,
    @Param('variationId')
    variationId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributeEditService.updateClassicCombination(
      itemId,
      variationId,
      changes,
    );
  }

  @Get(
    'nueva/:familyId/items/:itemId/atributos',
  )
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.attributeEditService.getNew(
      familyId,
      itemId,
    );
  }

  @Patch(
    'nueva/:familyId/items/:itemId/atributos',
  )
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributeEditService.updateNewAttribute(
      familyId,
      itemId,
      changes,
    );
  }
}