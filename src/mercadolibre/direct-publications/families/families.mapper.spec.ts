import { FamiliesMapper } from './families.mapper';

describe('FamiliesMapper listing summaries', () => {
  it('keeps USER_PRODUCT aggregates without returning variant items', () => {
    const result = FamiliesMapper.toListingSummary(
      {
        family_id: '200',
        site_id: 'MLA',
        user_id: 10,
        user_products_ids: ['MLAU1', 'MLAU2'],
      },
      [
        { id: 'MLA1', family_name: 'Familia', user_product_id: 'MLAU1', price: 100, currency_id: 'ARS', available_quantity: 2, sold_quantity: 4, status: 'active' },
        { id: 'MLA2', family_name: 'Familia', user_product_id: 'MLAU2', price: 150, currency_id: 'ARS', available_quantity: 3, sold_quantity: 6, status: 'active' },
      ],
    );

    expect(result).toMatchObject({
      model: 'VARIANT_PRICING',
      familyId: '200',
      itemId: 'MLA1',
      variantsCount: 2,
      itemsCount: 2,
      priceFrom: 100,
      priceTo: 150,
      stock: 5,
      sold: 10,
    });
    expect(result).not.toHaveProperty('variants');
  });
});
