import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { isJsonObject } from '../../shared/mercadolibre.types';

const CATEGORY_PATTERN = /^MLA\d+$/;
const CONDITION_SLUGS: Readonly<Record<string, string>> = {
  '2230284': 'new',
  '2230581': 'used',
  '2230582': 'refurbished',
};

export function prediction(value: unknown) {
  if (!isJsonObject(value)) throw invalidResponse();
  const id = string(value.category_id);
  const name = string(value.category_name);
  if (!id || !CATEGORY_PATTERN.test(id) || !name) throw invalidResponse();
  return {
    id,
    name,
    path: null,
    domainId: string(value.domain_id),
    domainName: string(value.domain_name),
  };
}

export function categoryDetail(value: unknown, expectedId: string) {
  if (!isJsonObject(value) || value.id !== expectedId) throw invalidResponse();
  const name = string(value.name);
  if (!name) throw invalidResponse();
  const settings = isJsonObject(value.settings) ? value.settings : {};
  const path = Array.isArray(value.path_from_root)
    ? value.path_from_root.flatMap((part) => {
        if (!isJsonObject(part)) return [];
        const partName = string(part.name);
        return partName ? [partName] : [];
      })
    : [];
  return {
    name,
    path: path.length ? path : null,
    listingAllowed:
      typeof settings.listing_allowed === 'boolean'
        ? settings.listing_allowed
        : null,
    maxPictures: integer(settings.max_pictures_per_item),
    maxPicturesPerVariation: integer(settings.max_pictures_per_item_var),
    maxVariations: integer(settings.max_variations_allowed),
    maxTitleLength: integer(settings.max_title_length),
    shippingModes: stringArray(settings.shipping_modes),
    conditions: stringArray(settings.item_conditions),
  };
}

export function categoryAttribute(value: unknown, usesUserProducts = false) {
  if (!isJsonObject(value)) throw invalidResponse();
  const id = string(value.id);
  const name = string(value.name);
  if (!id || !name) throw invalidResponse();
  const tags = isJsonObject(value.tags) ? value.tags : {};
  const hierarchy = string(value.hierarchy)?.toUpperCase();
  return {
    id,
    name,
    required:
      tags.required === true ||
      tags.catalog_required === true ||
      tags.catalog_listing_required === true,
    requiredOnNew: tags.new_required === true,
    valueType: string(value.value_type),
    valueMaxLength: integer(value.value_max_length),
    inputAllowed:
      id !== 'ITEM_CONDITION' &&
      tags.read_only !== true &&
      tags.inferred !== true &&
      tags.fixed !== true,
    role:
      hierarchy === 'CHILD_PK' ||
      tags.variation_attribute === true ||
      (!usesUserProducts && tags.allow_variations === true)
        ? ('CHILD_PK' as const)
        : hierarchy === 'PARENT_PK'
          ? ('PARENT_PK' as const)
          : ('COMMON' as const),
    variationAttribute: tags.variation_attribute === true,
    definesPicture: tags.defines_picture === true,
    values: Array.isArray(value.values) ? value.values.map(option) : [],
  };
}

export function availableOptions(value: unknown) {
  if (!isJsonObject(value) || !Array.isArray(value.available)) {
    throw invalidResponse();
  }
  return value.available.map(option);
}

export function categoryConditions(
  configured: readonly string[],
  values: readonly Readonly<{ id: string; name: string }>[],
) {
  const bySlug = new Map<
    string,
    { id: string; name: string; valueId: string | null }
  >();
  for (const value of values) {
    const slug = CONDITION_SLUGS[value.id] ?? conditionFromName(value.name);
    if (slug) {
      bySlug.set(slug, { id: slug, name: value.name, valueId: value.id });
    }
  }
  for (const slug of configured) {
    if (!bySlug.has(slug)) {
      bySlug.set(slug, { id: slug, name: conditionLabel(slug), valueId: null });
    }
  }
  return [...bySlug.values()];
}

export function requireCategoryId(value: unknown): string {
  if (typeof value !== 'string' || !CATEGORY_PATTERN.test(value)) {
    throw new BadRequestException('categoryId es invalido');
  }
  return value;
}

function conditionFromName(value: string): string | null {
  const normalized = value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (normalized === 'nuevo') return 'new';
  if (normalized === 'usado') return 'used';
  if (normalized === 'reacondicionado') return 'refurbished';
  return null;
}

function conditionLabel(value: string): string {
  if (value === 'new') return 'Nuevo';
  if (value === 'used') return 'Usado';
  if (value === 'refurbished') return 'Reacondicionado';
  if (value === 'not_specified') return 'No especificado';
  return value;
}

function option(value: unknown) {
  if (!isJsonObject(value)) throw invalidResponse();
  const id = string(value.id);
  const name = string(value.name);
  if (!id || !name) throw invalidResponse();
  return { id, name };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const candidates: unknown[] = value;
  return candidates.filter(
    (candidate): candidate is string => typeof candidate === 'string',
  );
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function invalidResponse(): BadGatewayException {
  return new BadGatewayException(
    'Mercado Libre devolvio una categoria invalida',
  );
}
