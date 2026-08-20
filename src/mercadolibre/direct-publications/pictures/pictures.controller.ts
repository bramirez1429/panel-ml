import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { PicturesService } from './pictures.service';

import type {
  PicturesUpdate,
} from './pictures.types';

@Controller('mercadolibre/direct/edicion')
export class PicturesController {
  constructor(
    private readonly picturesService:
      PicturesService,
  ) {}

  @Get('clasica/:itemId/imagenes')
  getClassic(
    @Param('itemId') itemId: string,
  ) {
    return this.picturesService.getClassicPictures(
      itemId,
    );
  }

  @Patch('clasica/:itemId/imagenes')
  updateClassic(
    @Param('itemId') itemId: string,
    @Body() changes: PicturesUpdate,
  ) {
    return this.picturesService.updateClassicPictures(
      itemId,
      changes,
    );
  }

  @Get('nueva/:familyId/items/:itemId/imagenes')
  getNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.picturesService.getNewPictures(
      familyId,
      itemId,
    );
  }

  @Patch('nueva/:familyId/items/:itemId/imagenes')
  updateNew(
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: PicturesUpdate,
  ) {
    return this.picturesService.updateNewPictures(
      familyId,
      itemId,
      changes,
    );
  }
}
