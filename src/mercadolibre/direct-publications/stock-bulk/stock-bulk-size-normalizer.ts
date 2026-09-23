import type { StockBulkProductType } from './stock-bulk.types';

const WOMAN_TSHIRT_SIZES = new Map<string, string>([
  ['38', 'S'],
  ['S', 'S'],
  ['40', 'M'],
  ['M', 'M'],
  ['42', 'L'],
  ['L', 'L'],
  ['44', 'XL'],
  ['XL', 'XL'],
  ['46', '2XL'],
  ['2XL', '2XL'],
]);

export function normalizeStockBulkSize(
  productType: StockBulkProductType,
  size: string,
): string {
  const normalized = size
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/gu, '');
  if (productType !== 'REMERA_MUJER') return normalized;
  return WOMAN_TSHIRT_SIZES.get(normalized) ?? normalized;
}
