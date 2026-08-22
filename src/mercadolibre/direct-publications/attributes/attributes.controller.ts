import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { AttributesService } from './attributes.service';

import type { AttributeUpdate } from './attributes.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class AttributesController {
  constructor(private readonly attributesService: AttributesService) {}

  @Get('clasica/:itemId/atributos')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.attributesService.getClassic(user.id, itemId);
  }

  @Patch('clasica/:itemId/atributos')
  updateClassicItem(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributesService.updateClassicItemAttribute(
      user.id,
      itemId,
      changes,
    );
  }

  @Patch('clasica/:itemId/variaciones/:variationId/atributos')
  updateClassicVariationAttribute(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Param('variationId')
    variationId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributesService.updateClassicVariationAttribute(
      user.id,
      itemId,
      variationId,
      changes,
    );
  }

  @Patch('clasica/:itemId/variaciones/:variationId/combinacion')
  updateClassicCombination(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Param('variationId')
    variationId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributesService.updateClassicCombination(
      user.id,
      itemId,
      variationId,
      changes,
    );
  }

  @Get('nueva/:familyId/items/:itemId/atributos')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.attributesService.getNew(user.id, familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/atributos')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: AttributeUpdate,
  ) {
    return this.attributesService.updateNewAttribute(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }
}
