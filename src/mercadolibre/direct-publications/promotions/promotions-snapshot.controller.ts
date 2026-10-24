import { Controller, Get, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';
import { PromotionsSnapshotService } from './promotions-snapshot.service';

@Controller('mercadolibre/direct/promociones/snapshot')
@UseGuards(AccessTokenGuard)
export class PromotionsSnapshotController {
  constructor(private readonly snapshot: PromotionsSnapshotService) {}

  @Get()
  getSnapshot(@CurrentUser() user: SafeUser) {
    return this.snapshot.getSnapshot(user.id);
  }
}
