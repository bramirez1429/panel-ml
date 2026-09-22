import type { MlAttribute, MlItem } from '../items/items.types';
import {
  normalizeStockBulkLabel,
  type StockBulkProductType,
} from './stock-bulk.types';

export type StockGarment = 'REMERA' | 'BUZO' | null;
export type StockAudience = 'MUJER' | 'NENA' | null;

const REMERA_DOMAIN = /(?:^|[^A-Z0-9])(?:T_?SHIRTS?|TSHIRTS?)(?:$|[^A-Z0-9])/u;
const BUZO_DOMAIN =
  /(?:^|[^A-Z0-9])(?:SWEATSHIRTS?(?:_AND_HOODIES)?|HOODIES?)(?:$|[^A-Z0-9])/u;
const REMERA_TITLE =
  /(?:^|[^A-Z0-9])(?:REMERAS?|T[\s_-]*SHIRTS?)(?:$|[^A-Z0-9])/u;
const BUZO_TITLE =
  /(?:^|[^A-Z0-9])(?:BUZOS?|HOODIES?|SUDADERAS?)(?:$|[^A-Z0-9])/u;

const MUJER =
  /(?:^|[^A-Z0-9])(?:MUJER(?:ES)?|WOMAN|WOMEN|FEMALE|DAMAS?)(?:$|[^A-Z0-9])/u;
const NENA = /(?:^|[^A-Z0-9])(?:NENAS?|NINAS?|GIRLS?|INFANTIL)(?:$|[^A-Z0-9])/u;

export function classifyGarment(item: MlItem): StockGarment {
  const domain = normalizeStockBulkLabel(item.domain_id);
  if (domain === 'MLA-T_SHIRTS') return 'REMERA';
  if (domain === 'MLA-SWEATSHIRTS_AND_HOODIES') return 'BUZO';

  const domainGarment = classifyGarmentText(domain, REMERA_DOMAIN, BUZO_DOMAIN);
  if (domainGarment) return domainGarment;

  return classifyGarmentText(
    normalizeStockBulkLabel(item.title),
    REMERA_TITLE,
    BUZO_TITLE,
  );
}

export function classifyAudience(item: MlItem): StockAudience {
  const gender = exactAttributeText(item.attributes, 'GENDER');
  const genderAudience = classifyAudienceText(gender);
  if (genderAudience) return genderAudience;

  return classifyAudienceText(normalizeStockBulkLabel(item.title));
}

export function matchesProductType(
  item: MlItem,
  productType: StockBulkProductType,
): boolean {
  const garment = classifyGarment(item);
  const audience = classifyAudience(item);

  switch (productType) {
    case 'REMERA_MUJER':
      return garment === 'REMERA' && audience === 'MUJER';
    case 'REMERA_NENA':
      return garment === 'REMERA' && audience === 'NENA';
    case 'BUZO_MUJER':
      return garment === 'BUZO' && audience === 'MUJER';
    case 'BUZO_NENA':
      return garment === 'BUZO' && audience === 'NENA';
  }
}

function classifyGarmentText(
  value: string,
  remeraPattern: RegExp,
  buzoPattern: RegExp,
): StockGarment {
  const isRemera = remeraPattern.test(value);
  const isBuzo = buzoPattern.test(value);
  if (isRemera === isBuzo) return null;
  return isRemera ? 'REMERA' : 'BUZO';
}

function classifyAudienceText(value: string): StockAudience {
  if (NENA.test(value)) return 'NENA';
  if (MUJER.test(value)) return 'MUJER';
  return null;
}

function exactAttributeText(
  attributes: readonly MlAttribute[] | undefined,
  targetId: 'GENDER',
): string {
  const attribute = attributes?.find(
    ({ id }) => normalizeStockBulkLabel(id) === targetId,
  );
  if (!attribute) return '';

  return normalizeStockBulkLabel(
    [attribute.value_name, ...(attribute.values ?? []).map(({ name }) => name)]
      .filter(Boolean)
      .join(' '),
  );
}
