import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { CurrentUser } from '../../../auth/presentation/current-user.decorator';

import { ItemUpdateService } from './item-update.service';

import type {
  ClassicItemUpdate,
  VariantPricingItemUpdate,
} from './item-update.types';

@Controller('mercadolibre/direct/edicion')
@UseGuards(AccessTokenGuard)
export class ItemController {
  constructor(private readonly itemUpdateService: ItemUpdateService) {}

  /** Edita una publicación clásica. */
  @Patch('clasica/:itemId')
  updateClassic(
    @CurrentUser() user: SafeUser,
    @Param('itemId') itemId: string,
    @Body() changes: ClassicItemUpdate,
  ) {
    return this.itemUpdateService.updateClassic(user.id, itemId, changes);
  }

  /** Edita un MLA de una publicación nueva. */
  @Patch('nueva/:familyId/items/:itemId')
  updateNew(
    @CurrentUser() user: SafeUser,
    @Param('familyId') familyId: string,
    @Param('itemId') itemId: string,
    @Body() changes: VariantPricingItemUpdate,
  ) {
    return this.itemUpdateService.updateVariantPricingItem(
      user.id,
      familyId,
      itemId,
      changes,
    );
  }
}
