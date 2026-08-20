import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { AttributesService } from './attributes.service';

import type {
  AttributeUpdate,
} from './attributes.types';

@Controller('mercadolibre/direct/edicion')
export class AttributesController {
  constructor(
    private readonly attributesService:
      AttributesService,
  ) {}

  @Get('clasica/:itemId/atributos')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.attributesService.getClassic(
      itemId,
    );
  }

  @Patch('clasica/:itemId/atributos')
  updateClassicItem(
    @Param('itemId') itemId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributesService.updateClassicItemAttribute(
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
    return this.attributesService.updateClassicVariationAttribute(
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
    return this.attributesService.updateClassicCombination(
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
    return this.attributesService.getNew(
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
    return this.attributesService.updateNewAttribute(
      familyId,
      itemId,
      changes,
    );
  }
}