import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PublicationCategoriesService,
  PublicationCategorySchema,
} from './publication-categories.service';
import { assertDraftMatchesSchema } from './publication-draft-policy';
import { PublicationPublishingCapabilitiesService } from './publication-publishing-capabilities.service';
import { parsePublicationDraft } from './publication-publishing-input';
import {
  DraftVariation,
  PublicationDraft,
  PublishingPlan,
} from './publication-publishing.types';
import {
  createLegacyItem,
  createUserProductItem,
} from './publication-publishing-payloads';

@Injectable()
export class PublicationPublishingPlannerService {
  constructor(
    private readonly capabilities: PublicationPublishingCapabilitiesService,
    private readonly categories: PublicationCategoriesService,
  ) {}

  /** Traduce el contrato del panel al modelo vivo habilitado para el seller. */
  async plan(body: unknown): Promise<PublishingPlan> {
    const draft = parsePublicationDraft(body);
    const context = await this.capabilities.getContext();
    if (context.managesWarehouse) {
      throw new BadRequestException(
        'Esta cuenta administra stock por depósito y el formulario actual no informa stock_locations',
      );
    }
    const schema = await this.categories.getSchemaForContext(
      draft.categoryId,
      context,
    );
    assertDraftMatchesSchema(draft, schema, context.usesUserProducts);
    if (context.usesUserProducts) {
      return {
        context,
        model: 'USER_PRODUCTS',
        items: this.userProductItems(draft, schema),
      };
    }
    return {
      context,
      model: 'LEGACY',
      items: [
        {
          description: draft.description,
          payload: createLegacyItem(draft, schema),
        },
      ],
    };
  }

  private userProductItems(
    draft: PublicationDraft,
    schema: PublicationCategorySchema,
  ) {
    if (!draft.familyName) {
      throw new BadRequestException(
        'familyName es obligatorio para sellers con User Products',
      );
    }
    const variants: Array<DraftVariation | null> = draft.variations.length
      ? draft.variations
      : [null];
    return variants.map((variation) => ({
      description: draft.description,
      payload: createUserProductItem(draft, variation, schema),
    }));
  }
}
