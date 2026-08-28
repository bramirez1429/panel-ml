import { IsEnum, IsOptional } from 'class-validator';

import type {
  PromotionCampaignAudience,
  PromotionCampaignQuery,
} from './promotions-campaigns.types';

export enum PromotionCampaignAudienceDto {
  WOMEN = 'WOMEN',
  GIRLS = 'GIRLS',
}

export class PromotionsCampaignsQueryDto implements PromotionCampaignQuery {
  @IsOptional()
  @IsEnum(PromotionCampaignAudienceDto)
  audience?: PromotionCampaignAudience;
}
