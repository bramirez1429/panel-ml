import { SimilarPublicationMetadataService } from './similar-publication-metadata.service';
import type { SimilarPublicationDraft } from './similar-publication.types';

describe('SimilarPublicationMetadataService', () => {
  it('enriquece el draft desde category metadata sin inventar atributos', async () => {
    const apiService = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path === '/categories/MLA109042') {
          return Promise.resolve({
            id: 'MLA109042',
            name: 'Remeras',
            settings: {
              item_conditions: ['new', 'used'],
            },
          });
        }
        if (path === '/categories/MLA109042/attributes') {
          return Promise.resolve(categoryAttributes());
        }
        if (path.includes('/available_listing_types')) {
          return Promise.resolve({
            available: [
              { id: 'gold_pro', name: 'Premium' },
              { id: 'gold_special', name: 'Clásica' },
            ],
          });
        }
        if (path === '/sites/MLA/listing_types/gold_pro') {
          return Promise.resolve({ id: 'gold_pro', name: 'Premium' });
        }
        if (path === '/catalog/charts/232382') {
          return Promise.resolve({
            id: '232382',
            names: { MLA: 'Guía Sael Niñas' },
            main_attribute_id: 'SIZE',
          });
        }
        throw new Error(`GET inesperado: ${path}`);
      }),
      post: jest.fn().mockResolvedValue({
        charts: [
          { id: '232382', names: { MLA: 'Guía Sael Niñas' } },
          { id: '999999', names: { MLA: 'Guía alternativa' } },
        ],
      }),
    };
    const service = new SimilarPublicationMetadataService(apiService as never);

    const result = await service.enrich({
      draft: baseDraft(),
      sellerId: 10,
      accessToken: 'token',
      items: [sourceItem()],
      userProducts: [],
    });

    expect(result).toMatchObject({
      categoryId: 'MLA109042',
      categoryName: 'Remeras',
      listingType: { id: 'gold_pro', name: 'Premium' },
      condition: { id: 'new', name: 'Nuevo' },
      ui: { showBuyingMode: false },
      sizeGuide: {
        id: '232382',
        name: 'Guía Sael Niñas',
        selected: true,
      },
      package: {
        hasFactoryPackaging: null,
        widthCm: 25,
        heightCm: 6,
        lengthCm: 31,
        weightKg: 0.214,
      },
    });
    expect(result.listingTypeOptions).toEqual(
      expect.arrayContaining([
        { id: 'gold_pro', name: 'Premium' },
        { id: 'gold_special', name: 'Clásica' },
      ]),
    );
    expect(result.conditionOptions).toEqual([
      { id: 'new', name: 'Nuevo' },
      { id: 'used', name: null },
    ]);
    expect(result.mainAttributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'BRAND',
          valueName: 'Sael',
          required: true,
          editable: true,
          inputType: 'TEXT',
          role: 'MAIN',
        }),
        expect.objectContaining({
          id: 'GENDER',
          valueName: 'Niñas',
          inputType: 'SELECT',
        }),
        expect.objectContaining({
          id: 'RECOMMENDED_USES',
          inputType: 'TAGS',
        }),
      ]),
    );
    expect(
      result.mainAttributes?.some(({ id }) => id === 'EMERGING_BRAND'),
    ).toBe(false);
    expect(result.commonAttributes?.some(({ id }) => id === 'SIZE')).toBe(
      false,
    );
    expect(result.variants[0].variantAttributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'SIZE', valueName: '6', role: 'SIZE' }),
        expect.objectContaining({
          id: 'COLOR',
          valueName: 'Negro',
          role: 'COLOR',
          display: { colorHex: '#000000' },
        }),
      ]),
    );
    expect(result.variants[1].colorAttribute).toMatchObject({
      valueName: 'Rojo',
      display: { colorHex: null },
    });
    expect(result.variants[0].sizeAttribute?.valueName).toBe('6');
    expect(result.sizeGuideOptions).toEqual([
      { id: '232382', name: 'Guía Sael Niñas', selected: true },
      { id: '999999', name: 'Guía alternativa', selected: false },
    ]);
    expect(result.buyingMode).toBe('buy_it_now');
    expect(apiService.post).toHaveBeenCalledWith(
      '/catalog/charts/search?offset=0&limit=100',
      expect.objectContaining({
        domain_id: 'TSHIRTS',
        site_id: 'MLA',
        seller_id: 10,
      }),
      'token',
    );
    expect(apiService.post.mock.calls.some(([path]) => path === '/items')).toBe(
      false,
    );
  });

  it('mantiene null cuando ML no informa guía, labels ni dimensiones', async () => {
    const apiService = {
      get: jest.fn().mockImplementation((path: string) => {
        if (path.endsWith('/attributes')) return Promise.resolve([]);
        if (path.includes('/available_listing_types')) {
          return Promise.resolve({ available: [] });
        }
        if (path.includes('/listing_types/')) return Promise.resolve(null);
        return Promise.resolve({
          id: 'MLA109042',
          name: 'Remeras',
          settings: {},
        });
      }),
      post: jest.fn().mockResolvedValue({ charts: [] }),
    };
    const service = new SimilarPublicationMetadataService(apiService as never);
    const draft = baseDraft();
    draft.variants = draft.variants.map((variant) => ({
      ...variant,
      attributes: [],
    }));
    const result = await service.enrich({
      draft,
      sellerId: 10,
      accessToken: 'token',
      items: [{ ...sourceItem(), attributes: [], condition: undefined }],
      userProducts: [],
    });

    expect(result.listingType).toEqual({ id: 'gold_pro', name: null });
    expect(result.condition).toBeNull();
    expect(result.sizeGuide).toBeNull();
    expect(result.package).toEqual({
      hasFactoryPackaging: null,
      widthCm: null,
      heightCm: null,
      lengthCm: null,
      weightKg: null,
    });
    expect(result.mainAttributes).toEqual([]);
  });
});

function baseDraft(): SimilarPublicationDraft {
  const common = [
    attribute('BRAND', 'Marca', 'Sael'),
    attribute('GENDER', 'Género', 'Niñas', '339668'),
    attribute('RECOMMENDED_USES', 'Usos recomendados', 'Casual'),
    attribute('SIZE_GRID_ID', 'Guía de talles', '232382'),
    attribute('SELLER_PACKAGE_WIDTH', 'Ancho del paquete', '25 cm'),
    attribute('SELLER_PACKAGE_HEIGHT', 'Alto del paquete', '6 cm'),
    attribute('SELLER_PACKAGE_LENGTH', 'Largo del paquete', '31 cm'),
    attribute('SELLER_PACKAGE_WEIGHT', 'Peso del paquete', '214 g'),
  ];
  return {
    sourceKey: 'item:MLA100',
    sourceType: 'LEGACY',
    categoryId: 'MLA109042',
    familyName: null,
    titleTemplate: 'Remera',
    description: 'Descripción',
    currencyId: 'ARS',
    listingTypeId: 'gold_pro',
    buyingMode: 'buy_it_now',
    saleTerms: [],
    shipping: { freeShipping: true },
    channels: ['marketplace'],
    variants: [
      {
        sourceReference: 'variant:1',
        price: 100,
        stock: 1,
        sku: null,
        attributes: [
          ...common,
          attribute('SIZE', 'Talle', '6', 'SIZE-6'),
          attribute('COLOR', 'Color', 'Negro', 'BLACK'),
          attribute('SIZE_GRID_ROW_ID', 'Fila guía', '232382:1'),
        ],
        pictureIds: [],
      },
      {
        sourceReference: 'variant:2',
        price: 100,
        stock: 1,
        sku: null,
        attributes: [
          ...common,
          attribute('SIZE', 'Talle', '8', 'SIZE-8'),
          attribute('COLOR', 'Color', 'Rojo', 'RED'),
          attribute('SIZE_GRID_ROW_ID', 'Fila guía', '232382:2'),
        ],
        pictureIds: [],
      },
    ],
    pictures: [],
  };
}

function sourceItem() {
  return {
    id: 'MLA100',
    seller_id: 10,
    category_id: 'MLA109042',
    domain_id: 'MLA-TSHIRTS',
    condition: 'new',
    attributes: [
      ...baseDraft().variants[0].attributes.map((attribute) => ({
        id: attribute.id,
        value_id: attribute.valueId,
        value_name: attribute.valueName,
      })),
      {
        id: 'ITEM_CONDITION',
        value_id: '2230284',
        value_name: 'Nuevo',
      },
    ],
  };
}

function categoryAttributes() {
  return [
    {
      id: 'ITEM_CONDITION',
      name: 'Condición',
      values: [
        { id: '2230284', name: 'Nuevo' },
        { id: '2230581', name: 'Usado' },
      ],
    },
    {
      id: 'BRAND',
      name: 'Marca',
      value_type: 'string',
      tags: { required: true },
      attribute_group_id: 'MAIN',
    },
    {
      id: 'GENDER',
      name: 'Género',
      value_type: 'list',
      values: [{ id: '339668', name: 'Niñas' }],
      attribute_group_id: 'MAIN',
    },
    {
      id: 'RECOMMENDED_USES',
      name: 'Usos recomendados',
      value_type: 'string',
      tags: { multivalued: true },
      attribute_group_id: 'MAIN',
    },
    {
      id: 'EMERGING_BRAND',
      name: 'Marca emergente',
      value_type: 'boolean',
      attribute_group_id: 'MAIN',
    },
    {
      id: 'SIZE',
      name: 'Talle',
      value_type: 'list',
      tags: { required: true, allow_variations: true },
      values: [
        { id: 'SIZE-6', name: '6' },
        { id: 'SIZE-8', name: '8' },
      ],
    },
    {
      id: 'COLOR',
      name: 'Color',
      type: 'color',
      tags: { allow_variations: true },
      values: [
        { id: 'BLACK', name: 'Negro', metadata: { rgb: '000000' } },
        { id: 'RED', name: 'Rojo' },
      ],
    },
    { id: 'SIZE_GRID_ID', name: 'Guía de talles' },
    {
      id: 'SIZE_GRID_ROW_ID',
      name: 'Fila guía',
      tags: { variation_attribute: true },
    },
    { id: 'SELLER_PACKAGE_WIDTH', name: 'Ancho', value_type: 'number_unit' },
    { id: 'SELLER_PACKAGE_HEIGHT', name: 'Alto', value_type: 'number_unit' },
    { id: 'SELLER_PACKAGE_LENGTH', name: 'Largo', value_type: 'number_unit' },
    { id: 'SELLER_PACKAGE_WEIGHT', name: 'Peso', value_type: 'number_unit' },
  ];
}

function attribute(
  id: string,
  name: string,
  valueName: string,
  valueId: string | null = null,
) {
  return { id, name, valueId, valueName, values: [] };
}
