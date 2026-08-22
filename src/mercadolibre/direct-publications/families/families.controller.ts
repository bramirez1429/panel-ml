import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import type { SafeUser } from '../../../auth/domain/auth.models';

import { FamiliesService } from './families.service';
import { FamiliesDetailService } from './families-detail.service';

@Controller('mercadolibre/direct/familias')
@UseGuards(AccessTokenGuard)
export class FamiliesController {
  constructor(
    private readonly familiesService: FamiliesService,
    private readonly familiesDetailService: FamiliesDetailService,
  ) {}

  /** Familia agrupada y liviana. */
  @Get(':familyId/resumen')
  getSummary(
    @CurrentUser() user: SafeUser,
    @Param('familyId')
    familyId: string,
  ) {
    return this.familiesService.getSummary(user.id, familyId);
  }

  /** Familia completa con precios y promociones. */
  @Get(':familyId')
  getDetail(
    @CurrentUser() user: SafeUser,
    @Param('familyId')
    familyId: string,
  ) {
    return this.familiesDetailService.getDetail(user.id, familyId);
  }
}
