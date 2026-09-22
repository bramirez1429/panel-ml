import type { MlItem } from '../items/items.types';
import {
  classifyAudience,
  classifyGarment,
  matchesProductType,
} from './stock-bulk-product-classifier';
import type { StockBulkProductType } from './stock-bulk.types';

const ALL_TYPES: readonly StockBulkProductType[] = [
  'BUZO_MUJER',
  'BUZO_NENA',
  'REMERA_MUJER',
  'REMERA_NENA',
];

describe('stock bulk product classifier', () => {
  it('clasifica una remera LEGACY de mujer por domain y title', () => {
    expectOnly(
      item({
        title: 'Remera Mujer Algod\u00f3n Peinado Cherries',
        domain_id: 'MLA-T_SHIRTS',
        attributes: [],
        variations: [{ id: 1 }],
      }),
      'REMERA_MUJER',
    );
  });

  it('clasifica una remera USER_PRODUCT de mujer con GENDER exacto', () => {
    expectOnly(
      item({
        title: 'Remera De Mujer Love Animal Print',
        domain_id: 'MLA-T_SHIRTS',
        user_product_id: 'MLAU123',
        family_id: 123,
        attributes: [
          { id: 'GENDER', value_name: 'Mujer' },
          { id: 'SIZE', value_name: '40' },
        ],
      }),
      'REMERA_MUJER',
    );
  });

  it('clasifica un buzo LEGACY de mujer con el domain real', () => {
    expectOnly(
      item({
        title: 'Buzo Mujer Cuello Redondo Algod\u00f3n Friza Premium',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
        attributes: [],
        variations: [{ id: 1 }],
      }),
      'BUZO_MUJER',
    );
  });

  it('clasifica una remera de nena por t\u00edtulo', () => {
    expectOnly(
      item({
        title: 'Remera De Nena Algod\u00f3n Manga Corta Infantil',
        domain_id: 'MLA-T_SHIRTS',
      }),
      'REMERA_NENA',
    );
  });

  it('clasifica un buzo de nena por t\u00edtulo', () => {
    expectOnly(
      item({
        title: 'Buzo Nena Rosa',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
      }),
      'BUZO_NENA',
    );
  });

  it('clasifica GENDER=Ni\u00f1as como REMERA_NENA', () => {
    expectOnly(
      item({
        title: 'Remera Manga Corta',
        domain_id: 'MLA-T_SHIRTS',
        attributes: [{ id: 'GENDER', value_name: 'Ni\u00f1as' }],
      }),
      'REMERA_NENA',
    );
  });

  it('clasifica GENDER=Mujer como BUZO_MUJER', () => {
    expectOnly(
      item({
        title: 'Buzo Cuello Redondo',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
        attributes: [{ id: 'GENDER', value_name: 'Mujer' }],
      }),
      'BUZO_MUJER',
    );
  });

  it('el domain de remera manda aunque el title mencione buzo', () => {
    const product = item({
      title: 'Remera Mujer con texto raro buzo',
      domain_id: 'MLA-T_SHIRTS',
    });

    expect(classifyGarment(product)).toBe('REMERA');
    expectOnly(product, 'REMERA_MUJER');
  });

  it('un atributo secundario Remera no cambia el domain de buzo', () => {
    const product = item({
      title: 'Buzo Mujer',
      domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
      attributes: [{ id: 'SELLER_DESCRIPTION', value_name: 'Remera' }],
    });

    expect(classifyGarment(product)).toBe('BUZO');
    expectOnly(product, 'BUZO_MUJER');
  });

  it('ignora completamente FILTRABLE_GENDER y usa el title', () => {
    const product = item({
      title: 'Remera De Mujer Animal Print',
      domain_id: 'MLA-T_SHIRTS',
      attributes: [
        {
          id: 'FILTRABLE_GENDER',
          value_name: 'Hombre,Mujer,Ni\u00f1as,Ni\u00f1os',
          values: [
            { name: 'Hombre' },
            { name: 'Mujer' },
            { name: 'Ni\u00f1as' },
            { name: 'Ni\u00f1os' },
          ],
        },
      ],
    });

    expect(classifyAudience(product)).toBe('MUJER');
    expectOnly(product, 'REMERA_MUJER');
  });

  it('AGE_GROUP no decide audiencia por s\u00ed solo', () => {
    expect(
      classifyAudience(
        item({
          title: 'Remera Lisa',
          attributes: [{ id: 'AGE_GROUP', value_name: 'Adultos' }],
        }),
      ),
    ).toBeNull();
    expect(
      classifyAudience(
        item({
          title: 'Remera Kids',
          attributes: [{ id: 'AGE_GROUP', value_name: 'Ni\u00f1os' }],
        }),
      ),
    ).toBeNull();
  });

  it.each([
    ['MLA-T_SHIRT', 'REMERA'],
    ['MLA-TSHIRTS', 'REMERA'],
    ['MLA-SWEATSHIRTS', 'BUZO'],
    ['MLA-HOODIES', 'BUZO'],
  ] as const)('acepta el domain fallback %s', (domainId, expected) => {
    expect(classifyGarment(item({ domain_id: domainId }))).toBe(expected);
  });

  it('excluye un producto que no puede clasificar con seguridad', () => {
    const product = item({ title: 'Producto Algod\u00f3n' });

    expect(classifyGarment(product)).toBeNull();
    expect(classifyAudience(product)).toBeNull();
    for (const productType of ALL_TYPES) {
      expect(matchesProductType(product, productType)).toBe(false);
    }
  });

  it('expone una clasificaci\u00f3n diagnosticable sin logs de producci\u00f3n', () => {
    const product = item({
      id: 'MLA109042',
      title: 'Remera De Mujer',
      domain_id: 'MLA-T_SHIRTS',
    });

    expect({
      itemId: product.id,
      title: product.title,
      domainId: product.domain_id,
      garment: classifyGarment(product),
      audience: classifyAudience(product),
    }).toEqual({
      itemId: 'MLA109042',
      title: 'Remera De Mujer',
      domainId: 'MLA-T_SHIRTS',
      garment: 'REMERA',
      audience: 'MUJER',
    });
  });
});

function expectOnly(itemValue: MlItem, expected: StockBulkProductType): void {
  for (const productType of ALL_TYPES) {
    expect(matchesProductType(itemValue, productType)).toBe(
      productType === expected,
    );
  }
}

function item(overrides: Partial<MlItem>): MlItem {
  return { id: 'MLA1', ...overrides };
}
