import { HttpException, Injectable } from '@nestjs/common';

import type { MercadoLibrePublication } from '../../publications/publication.types';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import type { MercadoLibreUserProduct } from '../../user-products/user-product.types';
import { isIdentifierAttribute } from './similar-publication.mapper';
import type {
  SimilarPublicationAttribute,
  SimilarPublicationAttributeInputType,
  SimilarPublicationAttributeOption,
  SimilarPublicationAttributeRole,
  SimilarPublicationChoice,
  SimilarPublicationDraft,
  SimilarPublicationPackage,
} from './similar-publication.types';

type CategoryAttributeMetadata = {
  id: string;
  name: string | null;
  required: boolean;
  editable: boolean;
  inputType: SimilarPublicationAttributeInputType;
  role: SimilarPublicationAttributeRole;
  options: SimilarPublicationAttributeOption[];
};

@Injectable()
export class SimilarPublicationMetadataService {
  constructor(private readonly apiService: MercadolibreApiService) {}

  async enrich(input: {
    draft: SimilarPublicationDraft;
    sellerId: number;
    accessToken: string;
    items: MercadoLibrePublication[];
    userProducts: MercadoLibreUserProduct[];
  }): Promise<SimilarPublicationDraft> {
    const categoryId = input.draft.categoryId;
    if (!categoryId) return this.emptyMetadata(input.draft);
    const currentListingTypeId = input.draft.listingTypeId;
    const sizeGuideId = findSourceAttributeValue(
      sourceAttributeContainers(input.items, input.userProducts),
      'SIZE_GRID_ID',
    );
    const sourceContainers = sourceAttributeContainers(
      input.items,
      input.userProducts,
    );
    const domainId = normalizeDomainId(input.items[0]?.domain_id);
    const [
      category,
      rawAttributes,
      availableListingTypes,
      listingType,
      chart,
      chartSearch,
    ] = await Promise.all([
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(categoryId)}`,
        input.accessToken,
      ),
      this.apiService.get<unknown>(
        `/categories/${encodeURIComponent(categoryId)}/attributes`,
        input.accessToken,
      ),
      this.optionalGet(
        `/users/${input.sellerId}/available_listing_types?category_id=${encodeURIComponent(categoryId)}`,
        input.accessToken,
      ),
      currentListingTypeId
        ? this.optionalGet(
            `/sites/MLA/listing_types/${encodeURIComponent(currentListingTypeId)}`,
            input.accessToken,
          )
        : Promise.resolve(null),
      sizeGuideId
        ? this.optionalGet(
            `/catalog/charts/${encodeURIComponent(sizeGuideId)}`,
            input.accessToken,
          )
        : Promise.resolve(null),
      domainId
        ? this.optionalPost(
            '/catalog/charts/search?offset=0&limit=100',
            {
              domain_id: domainId,
              site_id: 'MLA',
              seller_id: input.sellerId,
              attributes: sizeGuideSearchAttributes(sourceContainers),
            },
            input.accessToken,
          )
        : Promise.resolve(null),
    ]);
    const attributes = parseCategoryAttributes(rawAttributes, chart);
    const metadataById = new Map(attributes.map((entry) => [entry.id, entry]));
    const enrichedVariants = input.draft.variants.map((variant) => ({
      ...variant,
      attributes: variant.attributes.map((attribute) =>
        enrichAttribute(attribute, metadataById.get(attribute.id)),
      ),
    }));
    const requiredMissing = attributes
      .filter(
        (metadata) =>
          metadata.required &&
          metadata.editable &&
          !enrichedVariants.some((variant) =>
            variant.attributes.some(({ id }) => id === metadata.id),
          ),
      )
      .map(emptyAttribute);
    const commonAttributes = [
      ...commonAttributesOf(enrichedVariants),
      ...requiredMissing,
    ].filter((attribute) => !isPresentationDuplicate(attribute.id));
    const commonIds = new Set(commonAttributes.map(({ id }) => id));
    const variants = enrichedVariants.map((variant) => {
      const variantAttributes = variant.attributes.filter(
        ({ id }) => !commonIds.has(id) && id !== 'SIZE_GRID_ID',
      );
      return {
        ...variant,
        variantAttributes,
        sizeAttribute:
          variantAttributes.find(({ role }) => role === 'SIZE') ?? null,
        colorAttribute:
          variantAttributes.find(({ role }) => role === 'COLOR') ?? null,
      };
    });
    const listingTypeOptions = parseListingTypeOptions(availableListingTypes);
    const listingTypeName =
      listingTypeOptions.find(({ id }) => id === currentListingTypeId)?.name ??
      choiceFromObject(listingType)?.name ??
      null;
    const condition = parseCondition(
      input.items[0]?.condition,
      category,
      rawAttributes,
      sourceAttributeContainers(input.items, input.userProducts),
    );
    const sizeGuide = sizeGuideId
      ? {
          id: sizeGuideId,
          name: chartName(chart),
          selected: true,
        }
      : null;
    return {
      ...input.draft,
      categoryName: isJsonObject(category) ? text(category.name) : null,
      listingType: currentListingTypeId
        ? { id: currentListingTypeId, name: listingTypeName }
        : null,
      listingTypeOptions: ensureCurrentChoice(
        listingTypeOptions,
        currentListingTypeId,
        listingTypeName,
      ),
      ui: { showBuyingMode: input.draft.buyingMode !== 'buy_it_now' },
      condition: condition.current,
      conditionOptions: condition.options,
      commonAttributes,
      mainAttributes: commonAttributes.filter(
        ({ role }) => role === 'MAIN' || role === 'OTHER',
      ),
      sizeGuide,
      sizeGuideOptions: mergeSizeGuideOptions(
        parseSizeGuideOptions(chartSearch),
        sizeGuide,
      ),
      package: packageFromSource(sourceContainers, attributes),
      variants,
    };
  }

  private emptyMetadata(
    draft: SimilarPublicationDraft,
  ): SimilarPublicationDraft {
    return {
      ...draft,
      categoryName: null,
      listingType: draft.listingTypeId
        ? { id: draft.listingTypeId, name: null }
        : null,
      listingTypeOptions: draft.listingTypeId
        ? [{ id: draft.listingTypeId, name: null }]
        : [],
      ui: { showBuyingMode: draft.buyingMode !== 'buy_it_now' },
      condition: null,
      conditionOptions: [],
      commonAttributes: [],
      mainAttributes: [],
      sizeGuide: null,
      sizeGuideOptions: [],
      package: emptyPackage(),
    };
  }

  private async optionalGet(
    path: string,
    accessToken: string,
  ): Promise<unknown> {
    try {
      return await this.apiService.get<unknown>(path, accessToken);
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === 401 || error.getStatus() === 403)
      ) {
        throw error;
      }
      return null;
    }
  }

  private async optionalPost(
    path: string,
    body: unknown,
    accessToken: string,
  ): Promise<unknown> {
    try {
      return await this.apiService.post<unknown>(path, body, accessToken);
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === 401 || error.getStatus() === 403)
      ) {
        throw error;
      }
      return null;
    }
  }
}

function parseCategoryAttributes(
  value: unknown,
  chart: unknown,
): CategoryAttributeMetadata[] {
  if (!Array.isArray(value)) return [];
  const chartMainAttribute = isJsonObject(chart)
    ? text(chart.main_attribute_id)
    : null;
  return value.flatMap((entry: unknown) => {
    if (!isJsonObject(entry)) return [];
    const id = text(entry.id);
    if (!id) return [];
    const tags = isJsonObject(entry.tags) ? entry.tags : {};
    const options = parseAttributeOptions(entry.values);
    const role = attributeRole(entry, tags, options, chartMainAttribute);
    return [
      {
        id,
        name: text(entry.name),
        required: tags.required === true || tags.new_required === true,
        editable:
          tags.read_only !== true &&
          tags.inferred !== true &&
          tags.fixed !== true,
        inputType: attributeInputType(entry, tags, options),
        role,
        options,
      },
    ];
  });
}

function enrichAttribute(
  attribute: SimilarPublicationAttribute,
  metadata: CategoryAttributeMetadata | undefined,
): SimilarPublicationAttribute {
  const options = metadata?.options ?? [];
  const selected = options.find(
    (option) =>
      (attribute.valueId && option.id === attribute.valueId) ||
      (attribute.valueName && option.name === attribute.valueName) ||
      attribute.values.some(
        (value) =>
          (value.id && option.id === value.id) ||
          (value.name && option.name === value.name),
      ),
  );
  return {
    ...attribute,
    name: metadata?.name ?? attribute.name,
    required: metadata?.required ?? false,
    editable: metadata?.editable ?? false,
    inputType: metadata?.inputType ?? 'TEXT',
    role:
      metadata?.role ??
      (isIdentifierAttribute(attribute.id) ? 'IDENTIFIER' : 'OTHER'),
    options,
    display: { colorHex: selected?.colorHex ?? null },
  };
}

function emptyAttribute(
  metadata: CategoryAttributeMetadata,
): SimilarPublicationAttribute {
  return {
    id: metadata.id,
    name: metadata.name,
    valueId: null,
    valueName: null,
    values: [],
    required: metadata.required,
    editable: metadata.editable,
    inputType: metadata.inputType,
    role: metadata.role,
    options: metadata.options,
    display: { colorHex: null },
  };
}

function attributeRole(
  entry: Record<string, unknown>,
  tags: Record<string, unknown>,
  options: SimilarPublicationAttributeOption[],
  chartMainAttribute: string | null,
): SimilarPublicationAttributeRole {
  const id = text(entry.id) ?? '';
  if (isIdentifierAttribute(id) || entry.hierarchy === 'PRODUCT_IDENTIFIER') {
    return 'IDENTIFIER';
  }
  if (
    entry.type === 'color' ||
    options.some(({ colorHex }) => colorHex !== null)
  ) {
    return 'COLOR';
  }
  if (
    id === chartMainAttribute ||
    id.toUpperCase().includes('SIZE') ||
    text(entry.name)?.toLocaleLowerCase().includes('talle') === true
  ) {
    return 'SIZE';
  }
  if (
    tags.allow_variations === true ||
    tags.variation_attribute === true ||
    entry.hierarchy === 'CHILD_PK'
  ) {
    return 'VARIANT';
  }
  const groupId = text(entry.attribute_group_id)?.toUpperCase() ?? '';
  return groupId.includes('MAIN') || entry.hierarchy === 'PARENT_PK'
    ? 'MAIN'
    : 'OTHER';
}

function attributeInputType(
  entry: Record<string, unknown>,
  tags: Record<string, unknown>,
  options: SimilarPublicationAttributeOption[],
): SimilarPublicationAttributeInputType {
  if (tags.multivalued === true) return 'TAGS';
  const valueType = text(entry.value_type)?.toLowerCase();
  if (options.length > 0 || valueType === 'list' || valueType === 'boolean') {
    return 'SELECT';
  }
  return valueType === 'number' || valueType === 'number_unit'
    ? 'NUMBER'
    : 'TEXT';
}

function parseAttributeOptions(
  value: unknown,
): SimilarPublicationAttributeOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (!isJsonObject(entry)) return [];
    const id = identifier(entry.id);
    const name = text(entry.name);
    if (!id && !name) return [];
    const metadata = isJsonObject(entry.metadata) ? entry.metadata : null;
    return [{ id, name, colorHex: colorHex(metadata?.rgb) }];
  });
}

function commonAttributesOf(
  variants: Array<{ attributes: SimilarPublicationAttribute[] }>,
): SimilarPublicationAttribute[] {
  const [first, ...rest] = variants;
  if (!first) return [];
  return first.attributes.filter((candidate) =>
    rest.every((variant) =>
      variant.attributes.some(
        (attribute) =>
          attribute.id === candidate.id &&
          valueSignature(attribute) === valueSignature(candidate),
      ),
    ),
  );
}

function valueSignature(attribute: SimilarPublicationAttribute): string {
  return JSON.stringify({
    valueId: attribute.valueId,
    valueName: attribute.valueName,
    values: attribute.values,
  });
}

function parseListingTypeOptions(value: unknown): SimilarPublicationChoice[] {
  if (!isJsonObject(value) || !Array.isArray(value.available)) return [];
  return value.available.flatMap((entry: unknown) => {
    const choice = choiceFromObject(entry);
    return choice ? [choice] : [];
  });
}

function choiceFromObject(value: unknown): SimilarPublicationChoice | null {
  if (!isJsonObject(value)) return null;
  const id = identifier(value.id);
  return id ? { id, name: text(value.name) } : null;
}

function ensureCurrentChoice(
  choices: SimilarPublicationChoice[],
  currentId: string | null,
  currentName: string | null,
): SimilarPublicationChoice[] {
  if (!currentId || choices.some(({ id }) => id === currentId)) return choices;
  return [{ id: currentId, name: currentName }, ...choices];
}

function parseCondition(
  sourceCondition: unknown,
  category: unknown,
  rawAttributes: unknown,
  sourceContainers: unknown[],
): {
  current: SimilarPublicationChoice | null;
  options: SimilarPublicationChoice[];
} {
  const id = text(sourceCondition);
  const conditionAttribute = arrayObjects(rawAttributes).find(
    (entry) => entry.id === 'ITEM_CONDITION',
  );
  const labels = new Map(
    parseAttributeOptions(
      isJsonObject(conditionAttribute) ? conditionAttribute.values : null,
    ).flatMap((choice) =>
      choice.id ? [[choice.id, choice.name] as const] : [],
    ),
  );
  const sourceAttribute = findSourceAttribute(
    sourceContainers,
    'ITEM_CONDITION',
  );
  const sourceConditionName = sourceAttribute
    ? (text(sourceAttribute.value_name) ??
      arrayObjects(sourceAttribute.values).flatMap(
        (entry) => text(entry.name) ?? [],
      )[0] ??
      null)
    : null;
  if (id && sourceConditionName) labels.set(id, sourceConditionName);
  const settings =
    isJsonObject(category) && isJsonObject(category.settings)
      ? category.settings
      : null;
  const allowed = Array.isArray(settings?.item_conditions)
    ? settings.item_conditions.flatMap((value: unknown) => text(value) ?? [])
    : [];
  const options = allowed.map((conditionId) => ({
    id: conditionId,
    name: labels.get(conditionId) ?? null,
  }));
  return {
    current: id ? { id, name: labels.get(id) ?? null } : null,
    options,
  };
}

function chartName(value: unknown): string | null {
  if (!isJsonObject(value) || !isJsonObject(value.names)) return null;
  return (
    text(value.names.MLA) ??
    Object.values(value.names).flatMap((name) => text(name) ?? [])[0] ??
    null
  );
}

function parseSizeGuideOptions(value: unknown): SimilarPublicationChoice[] {
  if (!isJsonObject(value) || !Array.isArray(value.charts)) return [];
  return value.charts.flatMap((chart: unknown) => {
    if (!isJsonObject(chart)) return [];
    const id = identifier(chart.id);
    if (!id) return [];
    return [{ id, name: text(chart.name) ?? chartName(chart) }];
  });
}

function mergeSizeGuideOptions(
  options: SimilarPublicationChoice[],
  selected: SimilarPublicationDraft['sizeGuide'],
) {
  const result = new Map<
    string,
    { id: string; name: string | null; selected: boolean }
  >();
  for (const option of options) {
    result.set(option.id, { ...option, selected: option.id === selected?.id });
  }
  if (selected) result.set(selected.id, selected);
  return [...result.values()];
}

function sizeGuideSearchAttributes(containers: unknown[]) {
  return ['BRAND', 'GENDER'].flatMap((id) => {
    const attribute = findSourceAttribute(containers, id);
    if (!attribute) return [];
    const valueId = identifier(attribute.value_id);
    const valueName = text(attribute.value_name);
    if (!valueId && !valueName) return [];
    return [
      {
        id,
        values: [
          {
            ...(valueId ? { id: valueId } : {}),
            ...(valueName ? { name: valueName } : {}),
          },
        ],
      },
    ];
  });
}

function normalizeDomainId(value: unknown): string | null {
  const domainId = text(value);
  return domainId?.replace(/^MLA-/u, '') ?? null;
}

function sourceAttributeContainers(
  items: MercadoLibrePublication[],
  userProducts: MercadoLibreUserProduct[],
): unknown[] {
  return [
    ...items.flatMap((item) => [
      item.attributes,
      ...arrayObjects(item.variations).flatMap((variation) => [
        variation.attribute_combinations,
        variation.attributes,
      ]),
    ]),
    ...userProducts.map((userProduct) => userProduct.attributes),
  ];
}

function findSourceAttributeValue(
  containers: unknown[],
  attributeId: string,
): string | null {
  for (const container of containers) {
    for (const attribute of arrayObjects(container)) {
      if (attribute.id !== attributeId) continue;
      const value =
        identifier(attribute.value_id) ??
        text(attribute.value_name) ??
        arrayObjects(attribute.values).flatMap(
          (entry) => identifier(entry.id) ?? text(entry.name) ?? [],
        )[0];
      if (value) return value;
    }
  }
  return null;
}

function findSourceAttribute(
  containers: unknown[],
  attributeId: string,
): Record<string, unknown> | null {
  for (const container of containers) {
    const attribute = arrayObjects(container).find(
      (candidate) => candidate.id === attributeId,
    );
    if (attribute) return attribute;
  }
  return null;
}

function packageFromSource(
  containers: unknown[],
  metadata: CategoryAttributeMetadata[],
): SimilarPublicationPackage {
  const writableIds = new Set(
    metadata.filter(({ editable }) => editable).map(({ id }) => id),
  );
  const value = (ids: string[]): string | null => {
    const id = ids.find((candidate) => writableIds.has(candidate));
    return id ? findSourceAttributeValue(containers, id) : null;
  };
  return {
    hasFactoryPackaging: booleanValue(
      value(
        [...writableIds].filter((id) =>
          /(?:FACTORY|ORIGINAL)_PACKAG/iu.test(id),
        ),
      ),
    ),
    widthCm: dimensionCm(value(['SELLER_PACKAGE_WIDTH', 'PACKAGE_WIDTH'])),
    heightCm: dimensionCm(value(['SELLER_PACKAGE_HEIGHT', 'PACKAGE_HEIGHT'])),
    lengthCm: dimensionCm(value(['SELLER_PACKAGE_LENGTH', 'PACKAGE_LENGTH'])),
    weightKg: weightKg(value(['SELLER_PACKAGE_WEIGHT', 'PACKAGE_WEIGHT'])),
  };
}

function isPresentationDuplicate(id: string): boolean {
  return (
    id === 'SIZE_GRID_ID' ||
    /(?:SELLER_)?PACKAGE_(?:WIDTH|HEIGHT|LENGTH|WEIGHT)/u.test(id) ||
    /(?:FACTORY|ORIGINAL)_PACKAG/iu.test(id)
  );
}

function dimensionCm(value: string | null): number | null {
  return measurement(value, 'cm');
}

function weightKg(value: string | null): number | null {
  return measurement(value, 'kg');
}

function measurement(value: string | null, target: 'cm' | 'kg'): number | null {
  if (!value) return null;
  const match = /^([0-9]+(?:[.,][0-9]+)?)\s*([a-z]*)$/iu.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!(amount > 0)) return null;
  const unit = match[2].toLowerCase();
  if (target === 'kg') {
    if (unit === 'g') return amount / 1000;
    return unit === 'kg' || unit === '' ? amount : null;
  }
  if (unit === 'mm') return amount / 10;
  if (unit === 'm') return amount * 100;
  return unit === 'cm' || unit === '' ? amount : null;
}

function booleanValue(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase();
  if (['true', 'yes', 'sí', 'si'].includes(normalized)) return true;
  if (['false', 'no'].includes(normalized)) return false;
  return null;
}

function colorHex(value: unknown): string | null {
  const rgb = text(value)?.replace(/^#/u, '');
  return rgb && /^[0-9a-f]{6}$/iu.test(rgb) ? `#${rgb.toUpperCase()}` : null;
}

function emptyPackage(): SimilarPublicationPackage {
  return {
    hasFactoryPackaging: null,
    widthCm: null,
    heightCm: null,
    lengthCm: null,
    weightKg: null,
  };
}

function arrayObjects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> =>
    isJsonObject(entry),
  );
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return text(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
