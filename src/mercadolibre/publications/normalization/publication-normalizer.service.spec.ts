import { BadGatewayException } from '@nestjs/common';
import {
  MercadoLibrePublication,
  NormalizationContext,
  ResolvedVariantPublication,
} from '../publication.types';
import { PublicationModelDetectorService } from './publication-model-detector.service';
import { PublicationNormalizerService } from './publication-normalizer.service';

const context: NormalizationContext = {
  sellerId: 123456,
  syncedAt: '2026-08-09T12:00:00.000Z',
};

/** Crea el normalizador real. */
function createNormalizer(): PublicationNormalizerService {
  return new PublicationNormalizerService(
    new PublicationModelDetectorService(),
  );
}

/** Crea un MLA del modelo por variante. */
function variant(
  itemId: string,
  userProductId: string,
  overrides: MercadoLibrePublication = {},
): ResolvedVariantPublication {
  return {
    familyId: '8570150160678059',
    userProductId,
    userProductName: `User Product ${userProductId}`,
    publication: {
      id: itemId,
      family_name: 'Remera Nena K-pop',
      title: `Título ${itemId}`,
      status: 'paused',
      price: 38_000,
      currency_id: 'ARS',
      available_quantity: 5,
      sold_quantity: 1,
      thumbnail: `https://img/${itemId}.jpg`,
      category_id: 'MLA109042',
      permalink: `https://articulo/${itemId}`,
      listing_type_id: 'gold_special',
      last_updated: '2026-08-08T10:00:00Z',
      attributes: [],
      ...overrides,
    },
  };
}

describe('PublicationNormalizerService', () => {
  it('normaliza SHARED sin crear children y reduce variations', () => {
    const normalizer = createNormalizer();
    const result = normalizer.normalizeShared(
      {
        id: 'MLA100',
        family_name: null,
        user_product_id: 'MLAU-LEGACY',
        title: 'Remeras Pack X4',
        status: 'active',
        price: 50_000,
        currency_id: 'ARS',
        available_quantity: 99,
        thumbnail: 'https://img/shared.jpg',
        category_id: 'MLA109042',
        permalink: 'https://articulo/MLA100',
        last_updated: '2026-08-09T10:30:00-03:00',
        variations: [
          {
            id: 20,
            available_quantity: 3,
            sold_quantity: 2,
            attribute_combinations: [
              { id: 'COLOR', value_name: 'Rosa' },
              { id: 'SIZE', value_name: '10' },
            ],
          },
          {
            id: 10,
            available_quantity: 4,
            sold_quantity: 1,
            attribute_combinations: [{ id: 'COLOR', value_name: 'Blanco' }],
          },
        ],
      },
      context,
    );

    expect(result.children).toEqual([]);
    expect(result.parent).toMatchObject({
      seller_id: 123456,
      external_key: 'item:MLA100',
      model: 'SHARED',
      family_id: null,
      parent_item_id: 'MLA100',
      family_name: null,
      title: 'Remeras Pack X4',
      price_from: 50_000,
      price_to: 50_000,
      stock_total: 7,
      children_count: 0,
      source_updated_at: '2026-08-09T13:30:00.000Z',
      last_synced_at: context.syncedAt,
    });
    expect(result.parent.shared_variations).toEqual([
      {
        id: '10',
        label: 'Blanco',
        availableQuantity: 4,
        soldQuantity: 1,
        attributes: [{ id: 'COLOR', valueName: 'Blanco' }],
      },
      {
        id: '20',
        label: 'Rosa | 10',
        availableQuantity: 3,
        soldQuantity: 2,
        attributes: [
          { id: 'COLOR', valueName: 'Rosa' },
          { id: 'SIZE', valueName: '10' },
        ],
      },
    ]);
  });

  it('agrupa FAMILY con rango, stock, status y labels genéricos', () => {
    const normalizer = createNormalizer();
    const attributes = (color: string, size: string) => [
      { id: 'BRAND', value_name: 'ACME' },
      { id: 'COLOR', value_name: color },
      { id: 'SIZE', value_name: size },
    ];
    const sources = [
      variant('MLA333', 'MLAU333', {
        status: 'closed',
        price: 40_000,
        available_quantity: 2,
        last_updated: '2026-08-09T11:00:00Z',
        attributes: attributes('Negro', '14'),
      }),
      variant('MLA222', 'MLAU222', {
        status: 'paused',
        price: 38_000,
        available_quantity: 6,
        attributes: attributes('Rosa', '12'),
      }),
      variant('MLA111', 'MLAU111', {
        status: 'active',
        price: 35_000,
        available_quantity: 4,
        attributes: attributes('Azul', '10'),
      }),
    ];

    const result = normalizer.normalizeVariantFamily(sources, context);

    expect(result.parent).toMatchObject({
      external_key: 'family:8570150160678059',
      model: 'VARIANT_PRICING',
      family_id: '8570150160678059',
      parent_item_id: null,
      family_name: 'Remera Nena K-pop',
      title: 'Remera Nena K-pop',
      thumbnail: 'https://img/MLA111.jpg',
      status: 'active',
      price_from: 35_000,
      price_to: 40_000,
      stock_total: 12,
      children_count: 3,
      permalink: 'https://articulo/MLA111',
      source_updated_at: '2026-08-09T11:00:00.000Z',
      shared_variations: [],
    });
    expect(result.children.map((child) => child.item_id)).toEqual([
      'MLA111',
      'MLA222',
      'MLA333',
    ]);
    expect(result.children.map((child) => child.variant_label)).toEqual([
      'Azul | 10',
      'Rosa | 12',
      'Negro | 14',
    ]);
    expect(result.children[0]).toMatchObject({
      user_product_id: 'MLAU111',
      price: 35_000,
      available_quantity: 4,
      sold_quantity: 1,
      attributes: [
        { id: 'BRAND', valueName: 'ACME' },
        { id: 'COLOR', valueName: 'Azul' },
        { id: 'SIZE', valueName: '10' },
      ],
    });
  });

  it('usa title o MLAU cuando una familia no tiene atributos variables', () => {
    const normalizer = createNormalizer();
    const sources = [
      variant('MLA111', 'MLAU111', { title: 'Título visible' }),
      variant('MLA222', 'MLAU222', { title: null }),
    ];

    const result = normalizer.normalizeVariantFamily(sources, context);

    expect(result.children.map(({ variant_label }) => variant_label)).toEqual([
      'Título visible',
      'MLAU222',
    ]);
  });

  it('rechaza modelos, contextos y familias inconsistentes', () => {
    const normalizer = createNormalizer();

    expect(() =>
      normalizer.normalizeShared(
        { id: 'MLA1', family_name: 'Familia' },
        context,
      ),
    ).toThrow(BadGatewayException);
    expect(() => normalizer.normalizeVariantFamily([], context)).toThrow(
      BadGatewayException,
    );
    expect(() =>
      normalizer.normalizeVariantFamily(
        [
          variant('MLA1', 'MLAU1'),
          { ...variant('MLA2', 'MLAU2'), familyId: 'otra-familia' },
        ],
        context,
      ),
    ).toThrow(BadGatewayException);
  });
});
