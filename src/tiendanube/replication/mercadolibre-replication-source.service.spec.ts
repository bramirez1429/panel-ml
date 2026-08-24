import { ConflictException, ForbiddenException } from '@nestjs/common';

import { MercadolibreChildrenRepository } from '../../database/repositories/mercadolibre-children.repository';
import type {
  MercadolibreChildRow,
  MercadolibreProductDetail,
} from '../../database/repositories/mercadolibre-publications.types';
import { DescriptionService } from '../../mercadolibre/direct-publications/description/description.service';
import type { MercadoLibrePublication } from '../../mercadolibre/publications/publication.types';
import { PublicationSourceService } from '../../mercadolibre/publications/sync/publication-source.service';
import { UserProductFamilyService } from '../../mercadolibre/user-products/user-product-family.service';
import type {
  MercadoLibreUserProduct,
  UserProductFamilyCache,
} from '../../mercadolibre/user-products/user-product.types';
import { MercadoLibreReplicationSourceService } from './mercadolibre-replication-source.service';

const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER_ID = 123456;
const ACCESS_TOKEN = 'private-mercadolibre-token';

const SHARED_PRODUCT: MercadolibreProductDetail = {
  id: PRODUCT_ID,
  seller_id: SELLER_ID,
  external_key: 'item:MLA100001',
  model: 'SHARED',
  family_id: null,
  parent_item_id: 'MLA100001',
  family_name: null,
  title: 'Remera guardada',
  thumbnail: null,
  status: 'active',
  category_id: 'MLA109042',
  currency_id: 'ARS',
  price_from: 35_000,
  price_to: 35_000,
  stock_total: 7,
  children_count: 0,
  permalink: null,
  shared_variations: [],
  source_updated_at: null,
  last_synced_at: '2030-01-01T00:00:00.000Z',
  created_at: '2030-01-01T00:00:00.000Z',
  updated_at: '2030-01-01T00:00:00.000Z',
};

const FAMILY_PRODUCT: MercadolibreProductDetail = {
  ...SHARED_PRODUCT,
  external_key: 'family:778899',
  model: 'VARIANT_PRICING',
  family_id: '778899',
  parent_item_id: null,
  family_name: 'Remera familiar guardada',
  children_count: 3,
};

type ChildrenRepositoryMock = jest.Mocked<
  Pick<MercadolibreChildrenRepository, 'findByProductId'>
>;
type PublicationSourceMock = jest.Mocked<
  Pick<
    PublicationSourceService,
    'getItemWithAllAttributes' | 'getItemIdsForUserProducts'
  >
>;
type FamilyServiceMock = jest.Mocked<
  Pick<UserProductFamilyService, 'createCache' | 'getFamily' | 'getUserProduct'>
>;
type DescriptionServiceMock = jest.Mocked<
  Pick<DescriptionService, 'getPlainTextByItemId'>
>;

describe('MercadoLibreReplicationSourceService', () => {
  let service: MercadoLibreReplicationSourceService;
  let childrenRepository: ChildrenRepositoryMock;
  let publicationSource: PublicationSourceMock;
  let familyService: FamilyServiceMock;
  let descriptionService: DescriptionServiceMock;

  beforeEach(() => {
    childrenRepository = {
      findByProductId: jest.fn(),
    };
    publicationSource = {
      getItemWithAllAttributes: jest.fn(),
      getItemIdsForUserProducts: jest.fn(),
    };
    familyService = {
      createCache: jest.fn().mockReturnValue(createFamilyCache()),
      getFamily: jest.fn(),
      getUserProduct: jest.fn(),
    };
    descriptionService = {
      getPlainTextByItemId: jest.fn().mockResolvedValue(null),
    };
    service = new MercadoLibreReplicationSourceService(
      childrenRepository as unknown as MercadolibreChildrenRepository,
      publicationSource as unknown as PublicationSourceService,
      familyService as unknown as UserProductFamilyService,
      descriptionService as unknown as DescriptionService,
    );
  });

  it('lee SHARED vivo y conserva todas sus variaciones, SKU, precio, stock e imágenes', async () => {
    descriptionService.getPlainTextByItemId.mockResolvedValue(
      'Descripción real del MLA',
    );
    publicationSource.getItemWithAllAttributes.mockResolvedValue({
      id: 'MLA100001',
      seller_id: SELLER_ID,
      title: 'Remera real',
      price: 35_000,
      available_quantity: 7,
      pictures: [
        { url: 'http://example.com/one.jpg' },
        { secure_url: 'https://example.com/two.jpg' },
      ],
      variations: [
        {
          ...classicVariation(1, 'Negro', 'S', 4, 'REM-NEG-S'),
          price: 36_000,
        },
        classicVariation(2, 'Negro', 'M', 3, null),
      ],
    });

    await expect(
      service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).resolves.toEqual({
      title: 'Remera real',
      description: 'Descripción real del MLA',
      images: ['http://example.com/one.jpg', 'https://example.com/two.jpg'],
      attributes: [
        { id: 'COLOR', name: 'Color' },
        { id: 'SIZE', name: 'Talle' },
      ],
      variants: [
        {
          price: 36_000,
          stock: 4,
          sku: 'REM-NEG-S',
          values: [
            { attributeId: 'COLOR', value: 'Negro' },
            { attributeId: 'SIZE', value: 'S' },
          ],
        },
        {
          price: 35_000,
          stock: 3,
          sku: null,
          values: [
            { attributeId: 'COLOR', value: 'Negro' },
            { attributeId: 'SIZE', value: 'M' },
          ],
        },
      ],
    });
    expect(publicationSource.getItemWithAllAttributes).toHaveBeenCalledWith(
      'MLA100001',
      ACCESS_TOKEN,
    );
    expect(descriptionService.getPlainTextByItemId).toHaveBeenCalledWith(
      'MLA100001',
      ACCESS_TOKEN,
    );
    expect(childrenRepository.findByProductId).not.toHaveBeenCalled();
  });

  it('crea una sola variante SHARED cuando el MLA no tiene variations', async () => {
    publicationSource.getItemWithAllAttributes.mockResolvedValue({
      id: 'MLA100001',
      seller_id: SELLER_ID,
      title: 'Producto simple',
      price: 12_345.5,
      available_quantity: 8,
      seller_custom_field: 'CAMPO-INTERNO',
      pictures: [],
      attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-REAL' }],
      variations: [],
    });

    const result = await service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN);

    expect(result).toEqual({
      title: 'Producto simple',
      description: null,
      images: [],
      attributes: [],
      variants: [
        {
          price: 12_345.5,
          stock: 8,
          sku: 'SKU-REAL',
          values: [],
        },
      ],
    });
  });

  it.each([
    ['vacía', ''],
    ['ausente', null],
  ])(
    'representa una descripción SHARED %s como null',
    async (_case, description) => {
      descriptionService.getPlainTextByItemId.mockResolvedValue(description);
      publicationSource.getItemWithAllAttributes.mockResolvedValue({
        id: 'MLA100001',
        seller_id: SELLER_ID,
        title: 'Producto simple',
        price: 12_345.5,
        available_quantity: 8,
        pictures: [],
        attributes: [],
        variations: [],
      });

      await expect(
        service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN),
      ).resolves.toMatchObject({ description: null });
    },
  );

  it('no inventa un SKU a partir de seller_custom_field', async () => {
    publicationSource.getItemWithAllAttributes.mockResolvedValue({
      id: 'MLA100001',
      seller_id: SELLER_ID,
      title: 'Producto sin SKU',
      price: 12_345.5,
      available_quantity: 8,
      seller_custom_field: 'CAMPO-INTERNO',
      pictures: [],
      attributes: [],
      variations: [],
    });

    const result = await service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN);

    expect(result.variants).toEqual([
      {
        price: 12_345.5,
        stock: 8,
        sku: null,
        values: [],
      },
    ]);
  });

  it('rechaza variaciones SHARED con la misma combinación', async () => {
    publicationSource.getItemWithAllAttributes.mockResolvedValue({
      id: 'MLA100001',
      seller_id: SELLER_ID,
      title: 'Remera duplicada',
      price: 35_000,
      available_quantity: 2,
      pictures: [],
      variations: [
        classicVariation(1, 'Negro', 'S', 1, null),
        classicVariation(2, 'Negro', 'S', 1, null),
      ],
    });

    await expect(
      service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lee una familia real y produce un producto con una variante por MLAU', async () => {
    const userProductIds = ['MLAU1001', 'MLAU1002', 'MLAU1003'];
    descriptionService.getPlainTextByItemId.mockResolvedValue(
      'Descripción común de la familia',
    );
    childrenRepository.findByProductId.mockResolvedValue(
      userProductIds.map((userProductId, index) =>
        child(userProductId, `MLA20000${index + 1}`, index),
      ),
    );
    familyService.getFamily.mockResolvedValue({
      familyId: '778899',
      siteId: 'MLA',
      userId: SELLER_ID,
      userProductIds,
    });
    publicationSource.getItemIdsForUserProducts.mockResolvedValue([
      'MLA200001',
      'MLA200002',
      'MLA200003',
    ]);
    const items = new Map<string, MercadoLibrePublication>([
      [
        'MLA200001',
        familyItem('MLA200001', 'MLAU1001', 'Negro', 'S', 40_000, 2, 'SKU-S'),
      ],
      [
        'MLA200002',
        familyItem('MLA200002', 'MLAU1002', 'Negro', 'M', 41_000, 3, null),
      ],
      [
        'MLA200003',
        familyItem('MLA200003', 'MLAU1003', 'Blanco', 'S', 42_000, 4, 'SKU-BS'),
      ],
    ]);
    publicationSource.getItemWithAllAttributes.mockImplementation((itemId) =>
      Promise.resolve(items.get(itemId) as MercadoLibrePublication),
    );
    familyService.getUserProduct.mockImplementation((userProductId) =>
      Promise.resolve({
        id: userProductId,
        pictures: [
          { secure_url: `https://example.com/${userProductId}.jpg` },
          { secure_url: 'https://example.com/shared.jpg' },
        ],
      }),
    );

    const result = await service.load(FAMILY_PRODUCT, SELLER_ID, ACCESS_TOKEN);

    expect(result).toEqual({
      title: 'Remera familiar real',
      description: 'Descripción común de la familia',
      images: [
        'https://example.com/MLAU1001.jpg',
        'https://example.com/shared.jpg',
        'https://example.com/MLAU1002.jpg',
        'https://example.com/MLAU1003.jpg',
      ],
      attributes: [
        { id: 'COLOR', name: 'Color' },
        { id: 'SIZE', name: 'Talle' },
      ],
      variants: [
        {
          price: 40_000,
          stock: 2,
          sku: 'SKU-S',
          values: [
            { attributeId: 'COLOR', value: 'Negro' },
            { attributeId: 'SIZE', value: 'S' },
          ],
        },
        {
          price: 41_000,
          stock: 3,
          sku: null,
          values: [
            { attributeId: 'COLOR', value: 'Negro' },
            { attributeId: 'SIZE', value: 'M' },
          ],
        },
        {
          price: 42_000,
          stock: 4,
          sku: 'SKU-BS',
          values: [
            { attributeId: 'COLOR', value: 'Blanco' },
            { attributeId: 'SIZE', value: 'S' },
          ],
        },
      ],
    });
    expect(publicationSource.getItemIdsForUserProducts).toHaveBeenCalledWith(
      SELLER_ID,
      userProductIds,
      ACCESS_TOKEN,
    );
    expect(publicationSource.getItemWithAllAttributes).toHaveBeenCalledTimes(3);
    expect(descriptionService.getPlainTextByItemId.mock.calls).toEqual([
      ['MLA200001', ACCESS_TOKEN],
      ['MLA200002', ACCESS_TOKEN],
      ['MLA200003', ACCESS_TOKEN],
    ]);
    expect(familyService.getUserProduct).toHaveBeenCalledTimes(3);
  });

  it('rechaza descripciones diferentes de una familia antes de continuar', async () => {
    const userProductIds = ['MLAU1001', 'MLAU1002'];
    childrenRepository.findByProductId.mockResolvedValue([
      child('MLAU1001', 'MLA200001', 1),
      child('MLAU1002', 'MLA200002', 2),
    ]);
    familyService.getFamily.mockResolvedValue({
      familyId: '778899',
      siteId: 'MLA',
      userId: SELLER_ID,
      userProductIds,
    });
    publicationSource.getItemIdsForUserProducts.mockResolvedValue([
      'MLA200001',
      'MLA200002',
    ]);
    const items = new Map<string, MercadoLibrePublication>([
      [
        'MLA200001',
        familyItem('MLA200001', 'MLAU1001', 'Negro', 'S', 40_000, 2, null),
      ],
      [
        'MLA200002',
        familyItem('MLA200002', 'MLAU1002', 'Blanco', 'M', 41_000, 3, null),
      ],
    ]);
    publicationSource.getItemWithAllAttributes.mockImplementation((itemId) =>
      Promise.resolve(items.get(itemId) as MercadoLibrePublication),
    );
    descriptionService.getPlainTextByItemId.mockImplementation((itemId) =>
      Promise.resolve(
        itemId === 'MLA200001' ? 'Descripción uno' : 'Descripción dos',
      ),
    );

    await expect(
      service.load(FAMILY_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(descriptionService.getPlainTextByItemId.mock.calls).toEqual([
      ['MLA200001', ACCESS_TOKEN],
      ['MLA200002', ACCESS_TOKEN],
    ]);
    expect(familyService.getUserProduct).not.toHaveBeenCalled();
  });

  it('aborta antes de consultar MLA si un MLAU tiene múltiples children', async () => {
    childrenRepository.findByProductId.mockResolvedValue([
      child('MLAU1001', 'MLA200001', 1),
      child('MLAU1001', 'MLA200002', 2),
    ]);

    await expect(
      service.load(FAMILY_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(familyService.getFamily).not.toHaveBeenCalled();
    expect(publicationSource.getItemIdsForUserProducts).not.toHaveBeenCalled();
  });

  it('aborta si una dimensión de la familia está incompleta', async () => {
    const userProductIds = ['MLAU1001', 'MLAU1002'];
    childrenRepository.findByProductId.mockResolvedValue([
      child('MLAU1001', 'MLA200001', 1),
      child('MLAU1002', 'MLA200002', 2),
    ]);
    familyService.getFamily.mockResolvedValue({
      familyId: '778899',
      siteId: 'MLA',
      userId: SELLER_ID,
      userProductIds,
    });
    publicationSource.getItemIdsForUserProducts.mockResolvedValue([
      'MLA200001',
      'MLA200002',
    ]);
    const complete = familyItem(
      'MLA200001',
      'MLAU1001',
      'Negro',
      'S',
      40_000,
      2,
      null,
    );
    const incomplete = familyItem(
      'MLA200002',
      'MLAU1002',
      'Blanco',
      'M',
      41_000,
      3,
      null,
    );
    incomplete.attributes = (incomplete.attributes as unknown[]).filter(
      (attribute) =>
        typeof attribute !== 'object' ||
        attribute === null ||
        !('id' in attribute) ||
        attribute.id !== 'SIZE',
    );
    const items = new Map([
      ['MLA200001', complete],
      ['MLA200002', incomplete],
    ]);
    publicationSource.getItemWithAllAttributes.mockImplementation((itemId) =>
      Promise.resolve(items.get(itemId) as MercadoLibrePublication),
    );

    await expect(
      service.load(FAMILY_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(familyService.getUserProduct).not.toHaveBeenCalled();
  });

  it('aborta si Mercado Libre devuelve dos MLA para el mismo user_product_id', async () => {
    const userProductIds = ['MLAU1001', 'MLAU1002'];
    childrenRepository.findByProductId.mockResolvedValue([
      child('MLAU1001', 'MLA200001', 1),
      child('MLAU1002', 'MLA200002', 2),
    ]);
    familyService.getFamily.mockResolvedValue({
      familyId: '778899',
      siteId: 'MLA',
      userId: SELLER_ID,
      userProductIds,
    });
    publicationSource.getItemIdsForUserProducts.mockResolvedValue([
      'MLA200001',
      'MLA200009',
      'MLA200002',
    ]);
    publicationSource.getItemWithAllAttributes.mockImplementation((itemId) =>
      Promise.resolve(
        familyItem(
          itemId,
          itemId === 'MLA200002' ? 'MLAU1002' : 'MLAU1001',
          'Negro',
          itemId,
          itemId === 'MLA200009' ? 99_000 : 40_000,
          itemId === 'MLA200009' ? 99 : 2,
          null,
        ),
      ),
    );

    await expect(
      service.load(FAMILY_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toMatchObject({ status: 409 });
    expect(familyService.getUserProduct).not.toHaveBeenCalled();
  });

  it('rechaza un MLA que pertenece a otro seller', async () => {
    publicationSource.getItemWithAllAttributes.mockResolvedValue({
      id: 'MLA100001',
      seller_id: SELLER_ID + 1,
      title: 'Ajeno',
      price: 1,
      available_quantity: 1,
      variations: [],
    });

    await expect(
      service.load(SHARED_PRODUCT, SELLER_ID, ACCESS_TOKEN),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function classicVariation(
  id: number,
  color: string,
  size: string,
  stock: number,
  sku: string | null,
) {
  return {
    id,
    available_quantity: stock,
    attribute_combinations: [
      { id: 'COLOR', name: 'Color', value_name: color },
      { id: 'SIZE', name: 'Talle', value_name: size },
    ],
    attributes: sku ? [{ id: 'SELLER_SKU', value_name: sku }] : [],
  };
}

function familyItem(
  itemId: string,
  userProductId: string,
  color: string,
  size: string,
  price: number,
  stock: number,
  sku: string | null,
): MercadoLibrePublication {
  return {
    id: itemId,
    seller_id: SELLER_ID,
    family_id: '778899',
    family_name: 'Remera familiar real',
    user_product_id: userProductId,
    price,
    available_quantity: stock,
    pictures: [{ secure_url: `https://example.com/stale-${itemId}.jpg` }],
    attributes: [
      { id: 'COLOR', name: 'Color', value_name: color },
      { id: 'SIZE', name: 'Talle', value_name: size },
      { id: 'GTIN', name: 'GTIN', value_name: `779-${itemId}` },
      ...(sku ? [{ id: 'SELLER_SKU', value_name: sku }] : []),
    ],
  };
}

function child(
  userProductId: string,
  itemId: string,
  index: number,
): MercadolibreChildRow {
  return {
    id: `child-${index}`,
    product_id: PRODUCT_ID,
    item_id: itemId,
    user_product_id: userProductId,
    variant_label: null,
    title: null,
    thumbnail: null,
    status: 'active',
    currency_id: 'ARS',
    listing_type_id: 'gold_special',
    price: 1,
    available_quantity: 1,
    sold_quantity: 0,
    attributes: [],
    permalink: null,
    source_updated_at: null,
    last_synced_at: '2030-01-01T00:00:00.000Z',
    created_at: '2030-01-01T00:00:00.000Z',
    updated_at: '2030-01-01T00:00:00.000Z',
  };
}

function createFamilyCache(): UserProductFamilyCache {
  return {
    userProducts: new Map<string, Promise<MercadoLibreUserProduct>>(),
    families: new Map(),
    familyByUserProduct: new Map(),
  };
}
