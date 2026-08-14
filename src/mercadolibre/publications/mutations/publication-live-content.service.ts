import { ConflictException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import { parseLiveAttributes } from './publication-management.types';
import { PublicationManagementTargetService } from './publication-management-target.service';

@Injectable()
export class PublicationLiveContentService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Lee contenido vivo; para una familia usa un MLA representativo explicito. */
  async read(productId: string, itemIds: readonly string[]) {
    const itemId = itemIds.find((candidate) => /^MLA\d+$/.test(candidate));
    if (!itemId) return null;
    const context = await this.targets.resolve(productId, itemId);
    const item = await this.targets.getOwnedItem(context, true);
    return {
      content_item_id: context.target.itemId,
      content_is_representative: context.product.model === 'VARIANT_PRICING',
      title: text(item.title) ?? context.product.title,
      description: await this.getDescription(
        context.target.itemId,
        context.accessToken,
      ),
      attributes: parseLiveAttributes(item.attributes ?? []),
      has_flex: hasFlex(item.shipping),
    };
  }

  /** Obtiene la descripcion viva y tolera que el MLA todavia no tenga una. */
  async getDescription(
    itemId: string,
    accessToken: string,
  ): Promise<string | null> {
    const response = await this.apiService.getOptional<unknown>(
      '/items/' + encodeURIComponent(itemId) + '/description',
      accessToken,
    );
    if (response === null) return null;
    if (!isJsonObject(response)) {
      throw new ConflictException(
        'Mercado Libre devolvio una descripcion invalida',
      );
    }
    return text(response.plain_text) ?? '';
  }
}

function hasFlex(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  const logisticType = text(value.logistic_type)?.toLowerCase();
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  return (
    logisticType === 'self_service' ||
    tags.some((tag) => tag.toLowerCase().includes('self_service'))
  );
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
