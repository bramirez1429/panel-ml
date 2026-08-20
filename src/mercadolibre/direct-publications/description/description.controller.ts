import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { DescriptionService } from './description.service';

import type {
  DescriptionUpdate,
} from './description.types';

@Controller('mercadolibre/direct/edicion')
export class DescriptionController {
  constructor(
    private readonly descriptionService:
      DescriptionService,
  ) {}

  @Get('clasica/:itemId/descripcion')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.descriptionService.getClassic(
      itemId,
    );
  }

  @Post('clasica/:itemId/descripcion')
  createClassic(
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.createClassic(
      itemId,
      changes,
    );
  }

  @Patch('clasica/:itemId/descripcion')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.updateClassic(
      itemId,
      changes,
    );
  }

  @Get('nueva/:familyId/items/:itemId/descripcion')
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.descriptionService.getNew(
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
    return this.descriptionService.createNew(
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
    return this.descriptionService.updateNew(
      familyId,
      itemId,
      changes,
    );
  }
}