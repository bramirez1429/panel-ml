import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { DescriptionService } from './description.service';

import type { DescriptionUpdate } from './description.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class DescriptionController {
  constructor(private readonly descriptionService: DescriptionService) {}

  @Get('clasica/:itemId/descripcion')
  getClassic(@CurrentUser() user: SafeUser, @Param('itemId') itemId: string) {
    return this.descriptionService.getClassic(user.id, itemId);
  }

  @Post('clasica/:itemId/descripcion')
  createClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.createClassic(user.id, itemId, changes);
  }

  @Patch('clasica/:itemId/descripcion')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.updateClassic(user.id, itemId, changes);
  }

  @Get('nueva/:familyId/items/:itemId/descripcion')
  getNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.descriptionService.getNew(user.id, familyId, itemId);
  }

  @Post('nueva/:familyId/items/:itemId/descripcion')
  createNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.createNew(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }

  @Patch('nueva/:familyId/items/:itemId/descripcion')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: DescriptionUpdate,
  ) {
    return this.descriptionService.updateNew(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }
}
