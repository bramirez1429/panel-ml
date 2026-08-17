import { Controller, Get, Param } from '@nestjs/common';
import { DirectFamiliesService } from './direct-families.service';

@Controller('mercadolibre/direct/familias')
export class DirectFamiliesController {
  constructor(
    private readonly directFamiliesService: DirectFamiliesService,
  ) {}

  /** Trae una familia completa directamente desde Mercado Libre. */
  @Get(':familyId')
  getFamily(@Param('familyId') familyId: string) {
    return this.directFamiliesService.getFamily(familyId);
  }
}