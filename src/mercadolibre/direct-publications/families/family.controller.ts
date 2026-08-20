import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
} from '@nestjs/common';

import { FamilyUpdateService } from './family-update.service';

@Controller('mercadolibre/direct/edicion')
export class FamilyController {
  constructor(
    private readonly familyUpdateService:
      FamilyUpdateService,
  ) {}

  @Patch('nueva/:familyId')
  updateFamily(
    @Param('familyId') familyId: string,
    @Body()
    changes: {
      familyName?: string;
    },
  ) {
    return this.familyUpdateService.updateFamily(
      familyId,
      changes,
    );
  }

  @Get('nueva/tasks/:taskId')
  getTaskStatus(
    @Param('taskId') taskId: string,
  ) {
    return this.familyUpdateService.getTaskStatus(
      taskId,
    );
  }
}
