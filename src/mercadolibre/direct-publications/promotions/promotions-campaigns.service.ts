import { HttpException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PUBLICATION_REQUEST_CONCURRENCY } from '../../publications/publication.constants';
import { PublicationSourceService } from '../../publications/sync/publication-source.service';
import { ItemsService } from '../items/items.service';
import type { MlItem } from '../items/items.types';

import { classifyPromotionProductGroup } from './promotions-product-group';
import type {
  PromotionCampaign,
  PromotionCampaignAudience,
  PromotionCampaignQuery,
} from './promotions-campaigns.types';
import { PromotionsService } from './promotions.service';
import type { MlPromotion } from './promotions.types';

@Injectable()
export class PromotionsCampaignsService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly publicationSource: PublicationSourceService,
    private readonly itemsService: ItemsService,
    private readonly promotionsService: PromotionsService,
  ) {}

  async getCampaigns(userId: string, query: PromotionCampaignQuery) {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const campaigns = new Map<string, PromotionCampaign>();
    const seenItems = new Set<string>();
    let scrollId: string | undefined;

    while (true) {
      const scan = await this.publicationSource.fetchNextScanPage(
        connection.seller_id,
        accessToken,
        scrollId,
      );
      if (scan.itemIds.length === 0) break;

      const items = await this.itemsService.getMany(scan.itemIds, accessToken);
      const itemIds = this.eligibleItemIds(
        scan.itemIds,
        items,
        seenItems,
        query.audience,
      );
      await this.collectPageCampaigns(userId, itemIds, accessToken, campaigns);

      if (!scan.scrollId) break;
      scrollId = scan.scrollId;
    }

    return {
      campaigns: [...campaigns.values()].sort(
        (left, right) =>
          right.eligibleItems - left.eligibleItems ||
          left.name.localeCompare(right.name),
      ),
    };
  }

  private eligibleItemIds(
    scannedIds: readonly string[],
    items: readonly MlItem[],
    seenItems: Set<string>,
    audience?: PromotionCampaignAudience,
  ): string[] {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return scannedIds.flatMap((itemId) => {
      if (seenItems.has(itemId)) return [];
      seenItems.add(itemId);
      const item = itemsById.get(itemId);
      const productGroup = item ? classifyPromotionProductGroup(item) : null;
      if (!productGroup) return [];
      return !audience || productGroup.startsWith(audience) ? [itemId] : [];
    });
  }

  private async collectPageCampaigns(
    userId: string,
    itemIds: readonly string[],
    accessToken: string,
    campaigns: Map<string, PromotionCampaign>,
  ): Promise<void> {
    for (
      let index = 0;
      index < itemIds.length;
      index += PUBLICATION_REQUEST_CONCURRENCY
    ) {
      const batch = itemIds.slice(
        index,
        index + PUBLICATION_REQUEST_CONCURRENCY,
      );
      const results = await Promise.all(
        batch.map((itemId) => this.getCandidates(userId, itemId, accessToken)),
      );
      for (const candidates of results) {
        const itemCampaignIds = new Set<string>();
        for (const candidate of candidates) {
          const campaign = toCampaign(candidate);
          if (!campaign || itemCampaignIds.has(campaign.id)) continue;
          itemCampaignIds.add(campaign.id);
          const existing = campaigns.get(campaign.id);
          campaigns.set(
            campaign.id,
            existing
              ? { ...existing, eligibleItems: existing.eligibleItems + 1 }
              : campaign,
          );
        }
      }
    }
  }

  private async getCandidates(
    userId: string,
    itemId: string,
    accessToken: string,
  ): Promise<readonly MlPromotion[]> {
    try {
      return (
        await this.promotionsService.getPromotionsStrict(
          userId,
          itemId,
          accessToken,
        )
      ).candidates;
    } catch (error) {
      if (isAuthenticationError(error)) throw error;
      return [];
    }
  }
}

function toCampaign(promotion: MlPromotion): PromotionCampaign | null {
  const id = textOrNull(promotion.id);
  const type = textOrNull(promotion.type);
  if (!id || !type) return null;
  return {
    id,
    name: textOrNull(promotion.name) ?? fallbackName(type),
    type,
    eligibleItems: 1,
    startDate: textOrNull(promotion.start_date),
    finishDate: textOrNull(promotion.finish_date),
  };
}

function fallbackName(type: string): string {
  if (type === 'DEAL') return 'Oferta especial';
  return 'PromociÃ³n de Mercado Libre';
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isAuthenticationError(error: unknown): boolean {
  return (
    error instanceof HttpException &&
    (error.getStatus() === 401 || error.getStatus() === 403)
  );
}
