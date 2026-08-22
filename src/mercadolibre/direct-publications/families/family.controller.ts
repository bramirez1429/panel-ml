import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { FamilyUpdateService } from './family-update.service';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class FamilyController {
  constructor(private readonly familyUpdateService: FamilyUpdateService) {}

  @Patch('nueva/:familyId')
  updateFamily(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Body()
    changes: {
      familyName?: string;
    },
  ) {
    return this.familyUpdateService.updateFamily(user.id, familyId, changes);
  }

  @Get('nueva/tasks/:taskId')
  getTaskStatus(
    @CurrentUser() user: SafeUser,
    @Param('taskId') taskId: string,
  ) {
    return this.familyUpdateService.getTaskStatus(user.id, taskId);
  }
}
