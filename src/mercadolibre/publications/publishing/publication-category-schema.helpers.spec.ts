import { categoryAttribute } from './publication-category-schema.helpers';

describe('publication category schema helpers', () => {
  it('usa allow_variations solo para el modelo legacy', () => {
    const source = {
      id: 'COLOR',
      name: 'Color',
      tags: { allow_variations: true },
    };

    expect(categoryAttribute(source, false).role).toBe('CHILD_PK');
    expect(categoryAttribute(source, true).role).toBe('COMMON');
  });

  it('respeta hierarchy CHILD_PK para User Products', () => {
    expect(
      categoryAttribute(
        {
          id: 'COLOR',
          name: 'Color',
          hierarchy: 'CHILD_PK',
          tags: {},
        },
        true,
      ).role,
    ).toBe('CHILD_PK');
  });

  it('expone variation_attribute por variante también en User Products', () => {
    expect(
      categoryAttribute(
        {
          id: 'GTIN',
          name: 'Codigo universal',
          tags: { variation_attribute: true },
        },
        true,
      ),
    ).toMatchObject({ role: 'CHILD_PK', variationAttribute: true });
  });

  it('conserva defines_picture para validar galerias de variaciones', () => {
    expect(
      categoryAttribute({
        id: 'COLOR',
        name: 'Color',
        tags: { allow_variations: true, defines_picture: true },
      }),
    ).toMatchObject({ role: 'CHILD_PK', definesPicture: true });
  });
});
