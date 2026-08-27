import type { MlItem } from '../items/items.types';

import {
  classifyPromotionProductGroup,
  PromotionProductGroup,
} from './promotions-product-group';

describe('classifyPromotionProductGroup', () => {
  it.each([
    ['MLA-WOMEN_TSHIRTS', PromotionProductGroup.WOMEN_TSHIRT],
    ['MLA-WOMEN_SWEATSHIRTS', PromotionProductGroup.WOMEN_SWEATSHIRT],
    ['MLA-GIRLS_TSHIRTS', PromotionProductGroup.GIRLS_TSHIRT],
    ['MLA-GIRLS_SWEATSHIRTS', PromotionProductGroup.GIRLS_SWEATSHIRT],
  ])('clasifica %s como %s', (domain_id, expected) => {
    expect(classifyPromotionProductGroup({ domain_id } as MlItem)).toBe(
      expected,
    );
  });

  it('usa atributos reales cuando el dominio es genérico y nunca el título', () => {
    expect(
      classifyPromotionProductGroup({
        title: 'Buzo Mujer',
        attributes: [
          { id: 'GENDER', name: 'Género', value_name: 'Mujer' },
          { id: 'CLOTHING_TYPE', name: 'Tipo', value_name: 'Remera' },
        ],
      } as MlItem),
    ).toBe(PromotionProductGroup.WOMEN_TSHIRT);
    expect(
      classifyPromotionProductGroup({ title: 'Remera Mujer' } as MlItem),
    ).toBeNull();
  });

  it('excluye dominios que no pertenecen a los cuatro grupos', () => {
    expect(
      classifyPromotionProductGroup({ domain_id: 'MLA-WOMEN_SHOES' } as MlItem),
    ).toBeNull();
  });
});
