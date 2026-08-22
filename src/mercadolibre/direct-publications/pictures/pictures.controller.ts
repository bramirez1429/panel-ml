import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { PicturesService } from './pictures.service';

import type { PicturesUpdate } from './pictures.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class PicturesController {
  constructor(private readonly picturesService: PicturesService) {}

  @Get('clasica/:itemId/imagenes')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.picturesService.getClassicPictures(user.id, itemId);
  }

  @Patch('clasica/:itemId/imagenes')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: PicturesUpdate,
  ) {
    return this.picturesService.updateClassicPictures(user.id, itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/imagenes')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.picturesService.getNewPictures(user.id, familyId, itemId);
  }

  @Patch('nueva/:familyId/items/:itemId/imagenes')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: PicturesUpdate,
  ) {
    return this.picturesService.updateNewPictures(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }
}
