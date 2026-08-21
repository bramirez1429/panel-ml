import { Controller, Get, Param } from '@nestjs/common';

import { FamiliesService } from './families.service';
import { FamiliesDetailService } from './families-detail.service';

@Controller('mercadolibre/direct/familias')
export class FamiliesController {
  constructor(
    private readonly familiesService: FamiliesService,
    private readonly familiesDetailService: FamiliesDetailService,
  ) {}

  /** Familia agrupada y liviana. */
  @Get(':familyId/resumen')
  getSummary(
    @Param('familyId')
    familyId: string,
  ) {
    return this.familiesService.getSummary(familyId);
  }

  /** Familia completa con precios y promociones. */
  @Get(':familyId')
  getDetail(
    @Param('familyId')
    familyId: string,
  ) {
    return this.familiesDetailService.getDetail(familyId);
  }
}
