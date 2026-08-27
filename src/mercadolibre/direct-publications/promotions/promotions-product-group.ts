import type { MlItem } from '../items/items.types';

export enum PromotionProductGroup {
  WOMEN_TSHIRT = 'WOMEN_TSHIRT',
  WOMEN_SWEATSHIRT = 'WOMEN_SWEATSHIRT',
  GIRLS_TSHIRT = 'GIRLS_TSHIRT',
  GIRLS_SWEATSHIRT = 'GIRLS_SWEATSHIRT',
}

type Garment = 'TSHIRT' | 'SWEATSHIRT';
type Audience = 'WOMEN' | 'GIRLS';

const GENDER_IDS = new Set(['GENDER', 'GENDERID', 'SEX']);
const GARMENT_IDS = new Set([
  'CLOTHINGTYPE',
  'ITEMTYPE',
  'PRODUCTTYPE',
  'MODEL',
]);

export function classifyPromotionProductGroup(
  item: MlItem,
): PromotionProductGroup | null {
  const domain = normalize(item.domain_id);
  const domainAudience = audienceFromText(domain);
  const domainGarment = garmentFromText(domain);
  const signals = readAttributeSignals(item);
  const audience = domainAudience ?? signals.audience;
  const garment = domainGarment ?? signals.garment;
  if (!audience || !garment) return null;
  if (audience === 'WOMEN' && garment === 'TSHIRT')
    return PromotionProductGroup.WOMEN_TSHIRT;
  if (audience === 'WOMEN' && garment === 'SWEATSHIRT')
    return PromotionProductGroup.WOMEN_SWEATSHIRT;
  if (audience === 'GIRLS' && garment === 'TSHIRT')
    return PromotionProductGroup.GIRLS_TSHIRT;
  return PromotionProductGroup.GIRLS_SWEATSHIRT;
}

function readAttributeSignals(item: MlItem): {
  audience: Audience | null;
  garment: Garment | null;
} {
  let audience: Audience | null = null;
  let garment: Garment | null = null;
  for (const raw of item.attributes ?? []) {
    const id = normalize(raw.id);
    const value = normalize(raw.value_name ?? raw.values?.[0]?.name);
    if (!value) continue;
    if (GENDER_IDS.has(id)) audience = audienceFromText(value);
    if (GARMENT_IDS.has(id)) garment = garmentFromText(value);
  }
  return { audience, garment };
}

function audienceFromText(value: string): Audience | null {
  if (/WOMEN|MUJER|FEMALE/u.test(value)) return 'WOMEN';
  if (/GIRL|NINA|NINAS/u.test(value)) return 'GIRLS';
  return null;
}

function garmentFromText(value: string): Garment | null {
  if (/SWEATSHIRT|SWEATSHIRTS|BUZO|BUZOS|HOODIE/u.test(value))
    return 'SWEATSHIRT';
  if (/TSHIRT|TSHIRTS|REMERA|REMERAS/u.test(value)) return 'TSHIRT';
  return null;
}

function normalize(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/\p{M}+/gu, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, '')
    : '';
}
