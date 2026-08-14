import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import {
  availableOptions,
  categoryAttribute,
  categoryConditions,
  categoryDetail,
  prediction,
  requireCategoryId,
} from './publication-category-schema.helpers';
import { PublicationPublishingCapabilitiesService } from './publication-publishing-capabilities.service';
import type { PublishingContext } from './publication-publishing.types';

export type PublicationSchemaAttribute = ReturnType<typeof categoryAttribute>;
export type PublicationCategorySchema = Awaited<
  ReturnType<PublicationCategoriesService['getSchemaForContext']>
>;

@Injectable()
export class PublicationCategoriesService {
  constructor(
    private readonly capabilities: PublicationPublishingCapabilitiesService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  /** Usa el predictor oficial; no mantiene un arbol hardcodeado. */
  async search(query: unknown) {
    if (typeof query !== 'string') {
      throw new BadRequestException('q es obligatorio');
    }
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 120) {
      throw new BadRequestException('q debe tener entre 2 y 120 caracteres');
    }
    const context = await this.capabilities.getContext();
    const params = new URLSearchParams({
      q: normalized,
      limit: '8',
      target: 'core',
    });
    const response = await this.apiService.get<unknown>(
      `/sites/MLA/domain_discovery/search?${params.toString()}`,
      context.accessToken,
    );
    if (!Array.isArray(response)) {
      throw new BadGatewayException(
        'El predictor devolvio una respuesta invalida',
      );
    }
    return {
      categories: response.map((value) => prediction(value)),
    };
  }

  /** Devuelve atributos y valores de ML junto con opciones dinamicas. */
  async getSchema(categoryId: unknown) {
    const id = requireCategoryId(categoryId);
    const context = await this.capabilities.getContext();
    return this.getSchemaForContext(id, context);
  }

  /** Obtiene el esquema oficial de categoria usando el contexto conectado. */
  async getSchemaForContext(categoryId: string, context: PublishingContext) {
    const id = requireCategoryId(categoryId);
    const [category, attributes, listingTypes, saleTerms] = await Promise.all([
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(id)}`,
        context.accessToken,
      ),
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(id)}/attributes`,
        context.accessToken,
      ),
      this.apiService.get<unknown>(
        `/users/${context.sellerId}/available_listing_types?category_id=${encodeURIComponent(id)}`,
        context.accessToken,
      ),
      this.apiService.getOptional<unknown>(
        `/categories/${encodeURIComponent(id)}/sale_terms`,
        context.accessToken,
      ),
    ]);
    const detail = categoryDetail(category, id);
    const availableListingTypes = availableOptions(listingTypes);
    if (
      !Array.isArray(attributes) ||
      (saleTerms !== null && !Array.isArray(saleTerms))
    ) {
      throw new BadGatewayException(
        'Mercado Libre devolvio una categoria invalida',
      );
    }
    const mappedAttributes = attributes.map((attribute) =>
      categoryAttribute(attribute, context.usesUserProducts),
    );
    const conditionAttribute = mappedAttributes.find(
      (attribute) => attribute.id === 'ITEM_CONDITION',
    );
    return {
      category: {
        id,
        name: detail.name,
        path: detail.path,
      },
      usesUserProducts: context.usesUserProducts,
      familyNameRequired: context.usesUserProducts,
      attributes: mappedAttributes,
      saleTerms: (saleTerms ?? []).map((term) => categoryAttribute(term)),
      listingTypes: availableListingTypes,
      conditions: categoryConditions(
        detail.conditions,
        conditionAttribute?.values ?? [],
      ),
      settings: {
        listingAllowed: detail.listingAllowed,
        maxPictures: detail.maxPictures,
        maxPicturesPerVariation: detail.maxPicturesPerVariation,
        maxVariations: detail.maxVariations,
        maxTitleLength: detail.maxTitleLength,
        shippingModes: detail.shippingModes,
      },
    };
  }
}
