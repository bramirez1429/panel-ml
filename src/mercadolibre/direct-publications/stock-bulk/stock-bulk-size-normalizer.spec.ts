import { normalizeStockBulkSize } from './stock-bulk-size-normalizer';

describe('normalizeStockBulkSize', () => {
  it.each([
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
    ['2 xl', '2XL'],
    ['2-XL', '2XL'],
  ])('normaliza REMERA_MUJER %s como %s', (size, expected) => {
    expect(normalizeStockBulkSize('REMERA_MUJER', size)).toBe(expected);
  });

  it('mantiene BUZO_MUJER sin equivalencias num\u00e9rico/letra', () => {
    expect(normalizeStockBulkSize('BUZO_MUJER', '40')).toBe('40');
    expect(normalizeStockBulkSize('BUZO_MUJER', 'M')).toBe('M');
  });

  it('mantiene los talles num\u00e9ricos de nena', () => {
    expect(normalizeStockBulkSize('REMERA_NENA', '8')).toBe('8');
    expect(normalizeStockBulkSize('BUZO_NENA', '10')).toBe('10');
  });
});
