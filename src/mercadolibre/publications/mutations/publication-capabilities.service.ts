import { ConflictException, Injectable } from '@nestjs/common';
import { MercadolibreChildrenRepository } from '../../../database/repositories/mercadolibre-children.repository';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  isJsonObject,
  isNonEmptyString,
} from '../../shared/mercadolibre.types';
import { normalizePromotions } from '../promotions/publication-promotions.helpers';
import { hasRemovablePriceDiscount } from '../promotions/publication-price-discount-policy';
import {
  capabilityAttributes,
  categoryAttributeDefinitions,
} from './publication-attribute-policy';
import {
  parseLiveAttributes,
  parseOptionalItemId,
} from './publication-management.types';
import { PublicationLiveContentService } from './publication-live-content.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { titleEditability } from './publication-title.service';
import {
  editCapabilities,
  stockLocationTypes,
} from './publication-edit-capabilities';

@Injectable()
export class PublicationCapabilitiesService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly childrenRepository: MercadolibreChildrenRepository,
    private readonly apiService: MercadolibreApiService,
    private readonly liveContent: PublicationLiveContentService,
  ) {}

  /** Calcula permisos y contenido editable con el estado vivo del MLA. */
  async get(productId: string, requestedItemId: unknown) {
    const productContext = await this.targets.resolveProduct(productId);
    const requested = parseOptionalItemId(requestedItemId);
    const aggregate =
      productContext.product.model === 'VARIANT_PRICING' && !requested;
    const itemId =
      requested ??
      (productContext.product.model === 'SHARED'
        ? productContext.product.parent_item_id
        : await this.representativeItemId(productId));
    const context = await this.targets.resolve(productId, itemId);
    const live = await this.targets.getOwnedItem(context, true);
    const [definitions, description, sellerTags, promotionRows, stockTypes] =
      await Promise.all([
        this.definitions(live, context.accessToken),
        this.liveContent.getDescription(
          context.target.itemId,
          context.accessToken,
        ),
        this.sellerTags(context.sellerId, context.accessToken),
        this.promotions(context.target.itemId, context.accessToken),
        this.stockTypes(
          context.target.userProductId ?? text(live.user_product_id),
          context.accessToken,
        ),
      ]);
    const scopeReason = aggregate
      ? 'Selecciona un MLA concreto de la familia para editarlo'
      : null;
    const statusReason = contentStatusReason(live);
    const title = aggregate
      ? { editable: false, reason: scopeReason }
      : titleEditability(live);
    const contentEditable = !aggregate && statusReason === null;
    const editable = editCapabilities(
      live,
      sellerTags,
      stockTypes,
      aggregate,
    );
    const canApplyDiscount = promotionRows.some(
      ({ type, status }) =>
        type === 'PRICE_DISCOUNT' && status === 'candidate',
    );

    return {
      productId,
      itemId: context.target.itemId,
      representative: aggregate,
      ...editable,
      currentContent: {
        title: text(live.title),
        description,
        attributes: parseLiveAttributes(live.attributes ?? []),
      },
      fields: {
        title,
        description: {
          editable: contentEditable,
          reason: scopeReason ?? statusReason,
        },
        attributes: {
          editable:
            contentEditable &&
            definitions.some((definition) => definition.editable),
          reason:
            scopeReason ??
            statusReason ??
            (definitions.some((definition) => definition.editable)
              ? null
              : 'La categoria no expone atributos editables'),
        },
      },
      editableAttributes: aggregate
        ? []
        : capabilityAttributes(live.attributes, definitions),
      promotions: {
        priceDiscountApply: !aggregate && canApplyDiscount,
        priceDiscountRemove:
          !aggregate && hasRemovablePriceDiscount(promotionRows),
      },
    };
  }

  private async representativeItemId(productId: string): Promise<string> {
    const children = await this.childrenRepository.findByProductId(productId);
    const child = children.find(({ item_id }) => /^MLA\d+$/.test(item_id));
    if (!child) {
      throw new ConflictException(
        'La familia no tiene un MLA representativo valido',
      );
    }
    return child.item_id;
  }

  private async definitions(
    live: Record<string, unknown>,
    accessToken: string,
  ) {
    const categoryId = text(live.category_id);
    if (!categoryId || !/^MLA\d+$/.test(categoryId)) {
      throw new ConflictException('El item no tiene una categoria MLA valida');
    }
    const response = await this.apiService.get<unknown>(
      '/categories/' + encodeURIComponent(categoryId) + '/attributes',
      accessToken,
    );
    return categoryAttributeDefinitions(response, live);
  }

  private async sellerTags(sellerId: number, accessToken: string) {
    const response = await this.apiService.get<unknown>(
      `/users/${sellerId}`,
      accessToken,
    );
    if (
      !isJsonObject(response) ||
      response.id !== sellerId ||
      !Array.isArray(response.tags) ||
      response.tags.some((tag) => typeof tag !== 'string')
    ) {
      throw new ConflictException('Mercado Libre devolvió un seller inválido');
    }
    return response.tags as string[];
  }

  private async promotions(itemId: string, accessToken: string) {
    const response = await this.apiService.getOptional<unknown>(
      `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`,
      accessToken,
    );
    if (response === null) return [];
    return normalizePromotions(response);
  }

  private async stockTypes(
    userProductId: string | null,
    accessToken: string,
  ) {
    if (!userProductId) return [];
    const response = await this.apiService.getOptional<unknown>(
      `/user-products/${encodeURIComponent(userProductId)}/stock`,
      accessToken,
    );
    return stockLocationTypes(response);
  }
}

function contentStatusReason(item: Record<string, unknown>): string | null {
  if (item.status === 'closed') {
    return 'Una publicacion cerrada no admite cambios de contenido';
  }
  if (item.status === 'under_review') {
    return 'La publicacion debe resolver su moderacion antes de editar';
  }
  return null;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
