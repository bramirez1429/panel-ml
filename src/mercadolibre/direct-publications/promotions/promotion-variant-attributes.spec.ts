import { promotionVariantAttributesOf } from './promotion-variant-attributes';
import type { MlItem } from '../items/items.types';
const item = (extra: Partial<MlItem>): MlItem => ({ id: 'MLA123', ...extra });

describe('promotionVariantAttributesOf', () => {
  it('obtiene COLOR y SIZE reales de Mercado Libre', () => {
    expect(promotionVariantAttributesOf(item({ attributes: [
      { id: 'COLOR', value_name: 'Negro' }, { id: 'SIZE', value_name: 'XL' },
    ] }))).toEqual({ variantColor: 'Negro', variantSize: 'XL' });
  });
  it('interpreta Pack 2 como grupo sin inventar su color', () => {
    expect(promotionVariantAttributesOf(item({ attributes: [
      { id: 'PACK', value_name: 'Pack 2' }, { id: 'CLOTHING_SIZE', value_name: '40' },
    ] }))).toEqual({ variantColor: 'Pack 2', variantSize: '40' });
  });
  it('prioriza los atributos de una variación única', () => {
    expect(promotionVariantAttributesOf(item({
      attributes: [{ id: 'COLOR', value_name: 'Negro' }],
      variations: [{ attribute_combinations: [
        { id: 'COLOR', value_name: 'Rosa' }, { id: 'SIZE', value_name: '8' },
      ] }],
    }))).toEqual({ variantColor: 'Rosa', variantSize: '8' });
  });
  it('no deduce una única variante cuando hay varias combinaciones', () => {
    expect(promotionVariantAttributesOf(item({
      variations: [{ attribute_combinations: [{ id: 'COLOR', value_name: 'Negro' }] },
        { attribute_combinations: [{ id: 'COLOR', value_name: 'Rosa' }] }],
    }))).toEqual({ variantColor: null, variantSize: null });
  });
});
