import type { SaveVariantChannelLink, VariantChannelLink } from './sales.types';

export abstract class VariantChannelLinksRepository {
  abstract findByUserId(userId: string): Promise<VariantChannelLink[]>;
  abstract findByUserIdAndMlItemId(
    userId: string,
    mlItemId: string,
    mlVariationId?: string,
  ): Promise<VariantChannelLink[]>;
  abstract save(link: SaveVariantChannelLink): Promise<VariantChannelLink>;
}
