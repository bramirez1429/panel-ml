import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { DescriptionEditService } from './description-edit.service';

import type {
  DescriptionUpdate,
} from './description-edit.types';

@Controller('mercadolibre/direct/edicion')
export class DescriptionEditController {
  constructor(
    private readonly descriptionEditService:
      DescriptionEditService,
  ) {}

  @Get('clasica/:itemId/descripcion')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.descriptionEditService.getClassic(
      itemId,
    );
  }

  @Post('clasica/:itemId/descripcion')
  createClassic(
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionEditService.createClassic(
      itemId,
      changes,
    );
  }

  @Patch('clasica/:itemId/descripcion')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionEditService.updateClassic(
      itemId,
      changes,
    );
  }

  @Get('nueva/:familyId/items/:itemId/descripcion')
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.descriptionEditService.getNew(
      familyId,
      itemId,
    );
  }

  @Post('nueva/:familyId/items/:itemId/descripcion')
  createNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionEditService.createNew(
      familyId,
      itemId,
      changes,
    );
  }

  @Patch('nueva/:familyId/items/:itemId/descripcion')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionEditService.updateNew(
      familyId,
      itemId,
      changes,
    );
  }
}