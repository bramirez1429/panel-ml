import { productGroupOf } from './promotions-snapshot.service';

describe('catalog snapshot product classification', () => {
  it('identifies remeras de niña and mujer without requesting ML promotions', () => {
    expect(productGroupOf('Remera Niña cuello redondo', null)).toBe('GIRLS_TSHIRT');
    expect(productGroupOf('Remera Mujer cuello V', null)).toBe('WOMEN_TSHIRT');
  });
  it('classifies buzos and omits non-garment categories', () => {
    expect(productGroupOf('Buzo Mujer frizado', null)).toBe('WOMEN_SWEATSHIRT');
    expect(productGroupOf('Pack de zapatos', null)).toBeNull();
  });
});
