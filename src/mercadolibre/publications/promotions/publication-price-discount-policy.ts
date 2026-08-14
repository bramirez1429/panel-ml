import { BadRequestException, ConflictException } from '@nestjs/common';
import { isNonEmptyString } from '../../shared/mercadolibre.types';
import type { PublicationManagementContext } from '../mutations/publication-management-target.service';
import type { NormalizedPromotion } from './publication-promotions.helpers';

const REMOVABLE_STATUSES = new Set(['started', 'pending', 'sync_requested']);

/** Exige un candidato PRICE_DISCOUNT y valida el rango informado por ML. */
export function assertApplicablePriceDiscount(
  promotions: readonly NormalizedPromotion[],
  dealPrice: number,
): void {
  const candidate = promotions.find(
    ({ type, status }) =>
      type === 'PRICE_DISCOUNT' && status === 'candidate',
  );
  if (!candidate) {
    throw new ConflictException(
      'La publicación no es elegible para PRICE_DISCOUNT',
    );
  }
  if (
    candidate.minDiscountedPrice !== null &&
    dealPrice < candidate.minDiscountedPrice
  ) {
    throw new ConflictException(
      `El precio promocional mínimo es ${candidate.minDiscountedPrice}`,
    );
  }
  if (
    candidate.maxDiscountedPrice !== null &&
    dealPrice > candidate.maxDiscountedPrice
  ) {
    throw new ConflictException(
      `El precio promocional máximo es ${candidate.maxDiscountedPrice}`,
    );
  }
}

/** Indica si ML informa un PRICE_DISCOUNT que puede eliminarse. */
export function hasRemovablePriceDiscount(
  promotions: readonly NormalizedPromotion[],
): boolean {
  return promotions.some(
    ({ type, status }) =>
      type === 'PRICE_DISCOUNT' && REMOVABLE_STATUSES.has(status ?? ''),
  );
}

/** Expone el estado removible sin duplicar reglas en la lectura. */
export function isRemovablePriceDiscountStatus(status: string | null): boolean {
  return REMOVABLE_STATUSES.has(status ?? '');
}

/** Verifica hints opcionales sin permitir otro MLAU ni una variacion legacy. */
export function assertPriceDiscountTargetHints(
  context: PublicationManagementContext,
  selector: { variationId: unknown; userProductId: unknown },
): void {
  if (selector.userProductId !== undefined && selector.userProductId !== null) {
    if (
      !isNonEmptyString(selector.userProductId) ||
      selector.userProductId.trim() !== context.target.userProductId
    ) {
      throw new BadRequestException('userProductId no pertenece al item');
    }
  }
  if (selector.variationId !== undefined && selector.variationId !== null) {
    throw new BadRequestException(
      'PRICE_DISCOUNT se administra sobre la publicacion completa',
    );
  }
}
