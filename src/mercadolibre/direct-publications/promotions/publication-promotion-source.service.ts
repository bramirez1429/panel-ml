import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { FamiliesService } from '../families/families.service';
import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import { promotionError } from './promotion-errors';
import type {
  ResolvedPromotionItem,
  ResolvedPromotionSource,
} from './publication-promotion.types';

@Injectable()
export class PublicationPromotionSourceService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly itemsService: ItemsService,
    private readonly familiesService: FamiliesService,
  ) {}

  async resolve(
    userId: string,
    sourceKey: string,
  ): Promise<ResolvedPromotionSource> {
    const itemMatch = /^item:(MLA\d+)$/u.exec(sourceKey);
    if (itemMatch?.[1]) return this.resolveItem(userId, itemMatch[1]);
    const familyMatch = /^family:(\d+)$/u.exec(sourceKey);
    if (familyMatch?.[1]) return this.resolveFamily(userId, familyMatch[1]);
    throw new BadRequestException(
      'sourceKey debe tener formato item:MLA... o family:...',
    );
  }

  private async resolveItem(
    userId: string,
    itemId: string,
  ): Promise<ResolvedPromotionSource> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);
    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
      'promotion',
    );
    const model = PublicationsMapper.getModel(item);

    if (model === 'SHARED') {
      return {
        sourceKey: `item:${item.id}`,
        accessToken,
        items: [{ item, publication: { type: 'CLASSIC', itemId: item.id } }],
      };
    }

    const familyId = String(item.family_id ?? '').trim();

    if (!familyId) {
      throw new BadRequestException(
        'La publicación nueva no informa family_id',
      );
    }

    return {
      sourceKey: `item:${item.id}`,
      accessToken,
      items: [
        {
          item,
          publication: {
            type: 'NEW',
            familyId,
            itemId: item.id,
          },
        },
      ],
    };
  }

  private async resolveFamily(
    userId: string,
    familyId: string,
  ): Promise<ResolvedPromotionSource> {
    const resolved = await this.familiesService.getFamilyItems(
      userId,
      familyId,
    );
    const currentItemIds = [...new Set(resolved.itemIds)];
    const byId = new Map(resolved.items.map((item) => [item.id, item]));
    const items: ResolvedPromotionItem[] = currentItemIds.flatMap((itemId) => {
      const item = byId.get(itemId);
      return item
        ? [
            {
              item,
              publication: { type: 'NEW' as const, familyId, itemId },
            },
          ]
        : [];
    });
    if (items.length !== currentItemIds.length) {
      throw promotionError(
        'PROMOTION_PROVIDER_UNAVAILABLE',
        'No se pudieron resolver todos los MLA actuales de la familia',
      );
    }
    if (items.length === 0) {
      throw new BadRequestException('La familia no tiene MLA actuales');
    }
    return {
      sourceKey: `family:${familyId}`,
      accessToken: resolved.accessToken,
      items,
    };
  }
}
