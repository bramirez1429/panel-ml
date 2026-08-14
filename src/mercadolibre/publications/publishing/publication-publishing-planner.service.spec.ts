import { PublicationPublishingCapabilitiesService } from './publication-publishing-capabilities.service';
import { PublicationCategoriesService } from './publication-categories.service';
import { PublicationPublishingPlannerService } from './publication-publishing-planner.service';

const BASE_DRAFT = {
  categoryId: 'MLA1234',
  title: 'Zapatillas de prueba',
  familyName: 'Zapatillas Runner',
  currencyId: 'ARS',
  price: 100_000,
  stock: 3,
  listingTypeId: 'gold_special',
  condition: 'new',
  description: 'Descripcion de prueba',
  attributes: [{ id: 'BRAND', valueName: 'Acme' }],
  saleTerms: [],
  variations: [
    {
      sku: 'RUN-BLUE-42',
      price: 110_000,
      stock: 2,
      attributes: [
        { id: 'COLOR', valueId: '52051' },
        { id: 'SIZE', valueName: '42' },
      ],
      pictures: ['https://example.com/blue.jpg'],
    },
  ],
  pictures: ['https://example.com/common.jpg'],
  shipping: { mode: 'me2', freeShipping: true },
};

describe('PublicationPublishingPlannerService', () => {
  const getContext = jest.fn();
  const getSchemaForContext = jest.fn();
  const service = new PublicationPublishingPlannerService(
    { getContext } as unknown as PublicationPublishingCapabilitiesService,
    { getSchemaForContext } as unknown as PublicationCategoriesService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    getSchemaForContext.mockResolvedValue({
      attributes: [
        schemaAttribute('BRAND', 'PARENT_PK'),
        schemaAttribute('COLOR', 'CHILD_PK', ['52051']),
        schemaAttribute('SIZE', 'CHILD_PK'),
        {
          ...schemaAttribute('ITEM_CONDITION', 'COMMON', ['2230284']),
          inputAllowed: false,
        },
      ],
      saleTerms: [],
      listingTypes: [{ id: 'gold_special', name: 'Clasica' }],
      conditions: [{ id: 'new', name: 'Nuevo', valueId: '2230284' }],
      settings: {
        listingAllowed: true,
        maxPictures: 12,
        maxPicturesPerVariation: 10,
        maxVariations: 250,
        maxTitleLength: 60,
        shippingModes: ['me2'],
      },
    });
  });

  it('crea un item por child PK y omite title/variations en User Products', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: true,
      managesWarehouse: false,
    });

    const plan = await service.plan(BASE_DRAFT);

    expect(plan.model).toBe('USER_PRODUCTS');
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].payload).toEqual(
      expect.objectContaining({
        family_name: 'Zapatillas Runner',
        price: 110_000,
        available_quantity: 2,
        pictures: [{ source: 'https://example.com/blue.jpg' }],
      }),
    );
    expect(plan.items[0].payload).not.toHaveProperty('title');
    expect(plan.items[0].payload).not.toHaveProperty('variations');
    expect(plan.items[0].payload.attributes).toEqual(
      expect.arrayContaining([
        { id: 'BRAND', value_name: 'Acme' },
        { id: 'COLOR', value_id: '52051' },
        { id: 'SIZE', value_name: '42' },
        { id: 'SELLER_SKU', value_name: 'RUN-BLUE-42' },
        { id: 'ITEM_CONDITION', value_id: '2230284' },
      ]),
    );
  });

  it('preserva el contrato tradicional para sellers legacy', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: false,
      managesWarehouse: false,
    });

    const plan = await service.plan({
      ...BASE_DRAFT,
      variations: BASE_DRAFT.variations.map((variation) => ({
        ...variation,
        price: BASE_DRAFT.price,
        pictures: [],
      })),
    });

    expect(plan.model).toBe('LEGACY');
    expect(plan.items[0].payload).toEqual(
      expect.objectContaining({
        title: 'Zapatillas de prueba',
        variations: [
          expect.objectContaining({
            price: 100_000,
            available_quantity: 2,
          }),
        ],
      }),
    );
    const rawVariations = plan.items[0].payload.variations;
    const variations: unknown[] = Array.isArray(rawVariations)
      ? rawVariations
      : [];
    expect(variations[0]).toHaveProperty('picture_ids', [
      'https://example.com/common.jpg',
    ]);
    expect(plan.items[0].payload).not.toHaveProperty('family_name');
  });

  it('bloquea antes de consultar categoría si faltan stock_locations', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: true,
      managesWarehouse: true,
    });

    await expect(service.plan(BASE_DRAFT)).rejects.toMatchObject({
      status: 400,
    });
    expect(getSchemaForContext).not.toHaveBeenCalled();
  });

  it('envía atributos propios de variante fuera de attribute_combinations', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: false,
      managesWarehouse: false,
    });
    getSchemaForContext.mockResolvedValueOnce({
      attributes: [
        schemaAttribute('BRAND', 'PARENT_PK'),
        schemaAttribute('COLOR', 'CHILD_PK', ['52051']),
        {
          ...schemaAttribute('GTIN', 'CHILD_PK'),
          variationAttribute: true,
        },
        {
          ...schemaAttribute('ITEM_CONDITION', 'COMMON', ['2230284']),
          inputAllowed: false,
        },
      ],
      saleTerms: [],
      listingTypes: [{ id: 'gold_special', name: 'Clasica' }],
      conditions: [{ id: 'new', name: 'Nuevo', valueId: '2230284' }],
      settings: {
        listingAllowed: true,
        maxPictures: 12,
        maxPicturesPerVariation: 10,
        maxVariations: 250,
        maxTitleLength: 60,
        shippingModes: ['me2'],
      },
    });

    const plan = await service.plan({
      ...BASE_DRAFT,
      price: 110_000,
      variations: [
        {
          ...BASE_DRAFT.variations[0],
          attributes: [
            { id: 'COLOR', valueId: '52051' },
            { id: 'GTIN', valueName: '7791234567890' },
          ],
        },
      ],
    });
    const variations = plan.items[0].payload.variations as Array<
      Record<string, unknown>
    >;

    expect(variations[0].attribute_combinations).toEqual([
      { id: 'COLOR', value_id: '52051' },
    ]);
    expect(variations[0].attributes).toEqual([
      { id: 'GTIN', value_name: '7791234567890' },
      { id: 'SELLER_SKU', value_name: 'RUN-BLUE-42' },
    ]);
  });

  it('aplica el limite de fotos a cada item User Product, no a toda la familia', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: true,
      managesWarehouse: false,
    });
    const variation = BASE_DRAFT.variations[0];
    const pictures = (prefix: string) =>
      Array.from({ length: 8 }, (_, index) =>
        `https://example.com/${prefix}-${index}.jpg`,
      );

    const plan = await service.plan({
      ...BASE_DRAFT,
      variations: [
        { ...variation, pictures: pictures('blue') },
        {
          ...variation,
          sku: 'RUN-RED-43',
          attributes: [
            { id: 'COLOR', valueName: 'Rojo' },
            { id: 'SIZE', valueName: '43' },
          ],
          pictures: pictures('red'),
        },
      ],
    });

    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].payload.pictures).toHaveLength(8);
    expect(plan.items[1].payload.pictures).toHaveLength(8);
  });

  it('rechaza variantes con conjuntos distintos de atributos de variante', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: true,
      managesWarehouse: false,
    });

    await expect(
      service.plan({
        ...BASE_DRAFT,
        variations: [
          BASE_DRAFT.variations[0],
          {
            ...BASE_DRAFT.variations[0],
            sku: 'RUN-RED',
            attributes: [{ id: 'COLOR', valueName: 'Rojo' }],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rechaza galerias iguales para valores distintos de defines_picture', async () => {
    getContext.mockResolvedValue({
      sellerId: 42,
      accessToken: 'token',
      usesUserProducts: false,
      managesWarehouse: false,
    });
    getSchemaForContext.mockResolvedValueOnce({
      attributes: [
        schemaAttribute('BRAND', 'PARENT_PK'),
        { ...schemaAttribute('COLOR', 'CHILD_PK'), definesPicture: true },
        schemaAttribute('SIZE', 'CHILD_PK'),
      ],
      saleTerms: [],
      listingTypes: [{ id: 'gold_special', name: 'Clasica' }],
      conditions: [{ id: 'new', name: 'Nuevo', valueId: null }],
      settings: {
        listingAllowed: true,
        maxPictures: 12,
        maxPicturesPerVariation: 10,
        maxVariations: 250,
        maxTitleLength: 60,
        shippingModes: ['me2'],
      },
    });

    await expect(
      service.plan({
        ...BASE_DRAFT,
        price: 100_000,
        variations: [
          {
            ...BASE_DRAFT.variations[0],
            price: 100_000,
            pictures: [],
          },
          {
            ...BASE_DRAFT.variations[0],
            sku: 'RUN-RED-43',
            price: 100_000,
            attributes: [
              { id: 'COLOR', valueName: 'Rojo' },
              { id: 'SIZE', valueName: '43' },
            ],
            pictures: [],
          },
        ],
      }),
    ).rejects.toThrow('requiere imagenes diferentes');
  });
});

function schemaAttribute(
  id: string,
  role: 'COMMON' | 'PARENT_PK' | 'CHILD_PK',
  valueIds: readonly string[] = [],
) {
  return {
    id,
    name: id,
    required: false,
    requiredOnNew: false,
    valueType: 'string',
    valueMaxLength: 255,
    inputAllowed: true,
    role,
    variationAttribute: false,
    definesPicture: false,
    values: valueIds.map((valueId) => ({ id: valueId, name: valueId })),
  };
}
