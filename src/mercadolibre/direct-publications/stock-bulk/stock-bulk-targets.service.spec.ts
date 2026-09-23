import { StockBulkTargetsService } from './stock-bulk-targets.service';

describe('StockBulkTargetsService size matching', () => {
  const service = new StockBulkTargetsService();

  it('empareja REMERA_MUJER LEGACY request 40 con SIZE M', () => {
    const targets = service.collect(
      [
        {
          id: 'MLA1',
          title: 'Remera Mujer',
          domain_id: 'MLA-T_SHIRTS',
          status: 'active',
          variations: [
            {
              id: 123,
              available_quantity: 2,
              attribute_combinations: [{ id: 'SIZE', value_name: 'M' }],
            },
          ],
        },
      ],
      {
        productType: 'REMERA_MUJER',
        sizes: [{ size: '40', quantity: 3 }],
      },
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(
      expect.objectContaining({
        size: '40',
        variationId: '123',
        requestedQuantity: 3,
        model: 'LEGACY',
      }),
    );
  });

  it('empareja REMERA_MUJER USER_PRODUCT request 42 con SIZE L', () => {
    const targets = service.collect(
      [
        {
          id: 'MLA2',
          title: 'Remera Mujer',
          domain_id: 'MLA-T_SHIRTS',
          user_product_id: 'MLAU123',
          family_id: 999,
          status: 'active',
          attributes: [
            { id: 'GENDER', value_name: 'Mujer' },
            { id: 'SIZE', value_name: 'L' },
          ],
        },
      ],
      {
        productType: 'REMERA_MUJER',
        sizes: [{ size: '42', quantity: 5 }],
      },
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(
      expect.objectContaining({
        size: '42',
        userProductId: 'MLAU123',
        familyId: '999',
        requestedQuantity: 5,
        model: 'USER_PRODUCT',
      }),
    );
  });

  it('mantiene el matching num\u00e9rico de BUZO_MUJER', () => {
    const targets = service.collect(
      [legacyItem('MLA3', 'Buzo Mujer', 'MLA-SWEATSHIRTS_AND_HOODIES', '40')],
      {
        productType: 'BUZO_MUJER',
        sizes: [{ size: '40', quantity: 4 }],
      },
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(
      expect.objectContaining({ size: '40', requestedQuantity: 4 }),
    );
  });

  it('no empareja REMERA_MUJER request 40 con SIZE L', () => {
    const targets = service.collect(
      [legacyItem('MLA4', 'Remera Mujer', 'MLA-T_SHIRTS', 'L')],
      {
        productType: 'REMERA_MUJER',
        sizes: [{ size: '40', quantity: 3 }],
      },
    );

    expect(targets).toEqual([]);
  });

  it('acepta REMERA_MUJER antigua con SIZE num\u00e9rico', () => {
    const targets = service.collect(
      [legacyItem('MLA5', 'Remera Mujer', 'MLA-T_SHIRTS', '40')],
      {
        productType: 'REMERA_MUJER',
        sizes: [{ size: '40', quantity: 2 }],
      },
    );

    expect(targets).toHaveLength(1);
  });
});

function legacyItem(id: string, title: string, domainId: string, size: string) {
  return {
    id,
    title,
    domain_id: domainId,
    status: 'active',
    variations: [
      {
        id: 123,
        available_quantity: 2,
        attribute_combinations: [{ id: 'SIZE', value_name: size }],
      },
    ],
  };
}
