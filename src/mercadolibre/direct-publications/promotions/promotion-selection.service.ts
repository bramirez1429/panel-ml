import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import { PromotionManagerService } from './promotion-manager.service';
import { findRequestedCandidate } from './promotion-candidate.helpers';
import { promotionError } from './promotion-errors';
import type { PromotionSwitchRequest } from './promotion-manager.types';
import type { PromotionPublication } from './promotion-publication.types';
import { PromotionsService } from './promotions.service';

@Injectable()
export class PromotionSelectionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
    private readonly managerService: PromotionManagerService,
  ) {}

  async apply(userId: string, itemId: string, request: PromotionSwitchRequest) {
    try {
      const connection = await this.tokenService.getStoredConnection(userId);
      const token = await this.tokenService.getValidAccessToken(
        userId,
        connection,
      );
      const item = await this.itemsService.getOne(itemId, token);
      const publication = publicationOf(item);
      const promotions = await this.promotionsService.getPromotionsStrict(
        userId,
        itemId,
        token,
      );
      const candidateOfType = promotions.candidates.find(
        (candidate) => candidate.type === request.type,
      );
      if (!candidateOfType) {
        throw promotionError(
          'PROMOTION_NOT_FOUND',
          'La promoción elegida no existe entre las candidates actuales',
        );
      }
      if (!findRequestedCandidate(promotions.candidates, request)) {
        throw promotionError(
          'PROMOTION_NOT_APPLICABLE',
          'La promoción elegida ya no está disponible',
        );
      }
      await this.managerServiceSwitch(userId, itemId, publication, request);
      return { success: true, itemId, requestedPromotion: request.type };
    } catch (error) {
      if (isPromotionException(error)) throw error;
      throw promotionError(
        'PROMOTION_APPLICATION_FAILED',
        'No se pudo aplicar la promoción',
      );
    }
  }

  private async managerServiceSwitch(
    userId: string,
    itemId: string,
    publication: PromotionPublication,
    request: PromotionSwitchRequest,
  ): Promise<void> {
    if (publication.type === 'CLASSIC') {
      await this.managerService.switchClassic(userId, itemId, request);
    } else {
      await this.managerService.switchNew(
        userId,
        publication.familyId,
        itemId,
        request,
      );
    }
  }
}

function publicationOf(item: {
  id: string;
  family_id?: number | string | null;
  family_name?: string | null;
  variations?: unknown[];
  tags?: string[];
}): PromotionPublication {
  if (
    PublicationsMapper.getModel(item) === 'VARIANT_PRICING' &&
    item.family_id !== null &&
    item.family_id !== undefined
  ) {
    return { type: 'NEW', itemId: item.id, familyId: String(item.family_id) };
  }
  return { type: 'CLASSIC', itemId: item.id };
}

function isPromotionException(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { getResponse?: () => unknown };
  const response =
    typeof value.getResponse === 'function' ? value.getResponse() : null;
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    typeof response.code === 'string' &&
    response.code.startsWith('PROMOTION_')
  );
}
