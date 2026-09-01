import { BadRequestException } from '@nestjs/common';

import { SimilarPublicationCreationService } from './similar-publication-creation.service';
import type {
  SimilarPublicationCreateInput,
  SimilarPublicationDraft,
  SimilarPublicationSourceContext,
} from './similar-publication.types';
import { SimilarPublicationValidationService } from './similar-publication-validation.service';

describe('SimilarPublicationCreationService', () => {
  const draft: SimilarPublicationDraft = {
    sourceKey: 'item:MLA100',
    sourceType: 'LEGACY',
    categoryId: 'MLA1',
    familyName: null,
    titleTemplate: 'Título nuevo',
    description: 'Descripción',
    currencyId: 'ARS',
    listingTypeId: 'gold_special',
    buyingMode: 'buy_it_now',
    saleTerms: [],
    shipping: { freeShipping: true },
    channels: ['marketplace'],
    variants: [],
    pictures: [],
  };
  const input: SimilarPublicationCreateInput = {
    sourceKey: 'item:MLA100',
    categoryId: 'MLA1',
    familyName: 'Familia completamente nueva',
    titleTemplate: 'Título nuevo',
    description: null,
    currencyId: 'ARS',
    listingTypeId: 'gold_special',
    buyingMode: 'buy_it_now',
    saleTerms: [],
    shipping: { freeShipping: true },
    channels: ['marketplace'],
    pictures: [],
    variants: [
      {
        sourceReference: 'variant:1',
        price: 1000,
        stock: 4,
        sku: 'NEW-SKU',
        attributes: [
          {
            id: 'BRAND',
            name: 'Marca',
            valueId: null,
            valueName: 'Acme',
            values: [],
          },
          {
            id: 'GTIN',
            name: 'EAN',
            valueId: null,
            valueName: null,
            values: [],
          },
        ],
        pictureIds: ['NEW-PICTURE'],
      },
    ],
  };

  it('crea Legacy por allowlist, sin IDs source ni PUT', async () => {
    const { service, apiService } = setup({ sellerUsesUp: false });
    apiService.post.mockResolvedValueOnce({ id: 'MLA999' });
    const result = await service.create('user', input);
    const [path, payload] = safeMockCall(apiService.post, 0);
    expect(path).toBe('/items');
    expect(payload).toMatchObject({
      title: 'Título nuevo',
      category_id: 'MLA1',
      price: 1000,
      pictures: [{ id: 'NEW-PICTURE' }],
    });
    for (const field of [
      'id',
      'family_id',
      'user_product_id',
      'seller_id',
      'inventory_id',
      'sold_quantity',
      'promotions',
      'catalog_product_id',
    ])
      expect(payload).not.toHaveProperty(field);
    expect(apiService.put).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'SUCCESS',
      sourceKey: 'item:MLA999',
    });
    expect(result.sourceKey).not.toBe(input.sourceKey);
  });

  it('seller UP omite title/variations y crea variantes secuencialmente', async () => {
    const upDraft = {
      ...draft,
      sourceType: 'USER_PRODUCT' as const,
      familyName: 'Vieja',
    };
    const { service, apiService } = setup({
      sellerUsesUp: true,
      draft: upDraft,
    });
    let releaseFirst!: (value: unknown) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => (firstStarted = resolve));
    let itemPosts = 0;
    apiService.post.mockImplementation((path: string) => {
      if (path !== '/items') return Promise.resolve({});
      itemPosts += 1;
      if (itemPosts === 1) {
        firstStarted();
        return new Promise((resolve) => (releaseFirst = resolve));
      }
      return Promise.resolve({
        id: 'MLA902',
        user_product_id: 'MLAU2',
        family_id: 77,
      });
    });
    const promise = service.create('user', {
      ...input,
      familyName: 'Nueva',
      variants: [
        input.variants[0],
        {
          ...input.variants[0],
          sourceReference: 'variant:2',
          sku: 'NEW-SKU-2',
        },
      ],
    });
    await started;
    expect(itemPosts).toBe(1);
    releaseFirst({ id: 'MLA901', user_product_id: 'MLAU1', family_id: 77 });
    const result = await promise;
    expect(itemPosts).toBe(2);
    const payloads = Array.from(
      { length: apiService.post.mock.calls.length },
      (_, index) => safeMockCall(apiService.post, index),
    )
      .filter(([path]) => path === '/items')
      .map(([, payload]) => payload);
    for (const payload of payloads) {
      expect(payload).not.toHaveProperty('title');
      expect(payload).not.toHaveProperty('variations');
      expect(payload).not.toHaveProperty('family_id');
      expect(payload).not.toHaveProperty('user_product_id');
    }
    expect(result.sourceKey).toBe('family:77');
  });

  it('bloquea familyName original para User Products antes del POST', async () => {
    const { service, apiService } = setup({
      sellerUsesUp: true,
      draft: {
        ...draft,
        sourceType: 'USER_PRODUCT',
        familyName: 'Familia vieja',
      },
    });
    await expect(
      service.create('user', {
        ...input,
        familyName: 'familia vieja',
      }),
    ).rejects.toThrow(
      'Modificá el nombre de la familia para crear una publicación similar.',
    );
    expect(apiService.post).not.toHaveBeenCalled();
  });

  it('conserva éxitos ante fallo parcial y no reintenta /items', async () => {
    const { service, apiService } = setup({
      sellerUsesUp: true,
      draft: { ...draft, sourceType: 'USER_PRODUCT', familyName: 'Vieja' },
    });
    apiService.post
      .mockResolvedValueOnce({
        id: 'MLA901',
        user_product_id: 'MLAU1',
        family_id: 77,
      })
      .mockRejectedValueOnce(new BadRequestException('atributo inválido'));
    const result = await service.create('user', {
      ...input,
      familyName: 'Nueva',
      variants: [
        input.variants[0],
        {
          ...input.variants[0],
          sourceReference: 'variant:2',
          sku: 'NEW-2',
        },
      ],
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.items).toEqual([
      expect.objectContaining({ status: 'CREATED', itemId: 'MLA901' }),
      expect.objectContaining({ status: 'ERROR', itemId: null }),
    ]);
    expect(apiService.post).toHaveBeenCalledTimes(2);
  });

  it('rechaza SKU, GTIN o pictureId heredados', async () => {
    const { service, apiService } = setup({
      sellerUsesUp: false,
      originalIdentifiers: new Set(['old-sku']),
      originalPictures: new Set(['OLD-PICTURE']),
    });
    await expect(
      service.create('user', {
        ...input,
        variants: [
          {
            ...input.variants[0],
            sku: 'OLD-SKU',
            pictureIds: ['OLD-PICTURE'],
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(apiService.post).not.toHaveBeenCalled();
  });

  function setup(options: {
    sellerUsesUp: boolean;
    draft?: SimilarPublicationDraft;
    originalIdentifiers?: Set<string>;
    originalPictures?: Set<string>;
  }) {
    const source: SimilarPublicationSourceContext = {
      sellerId: 10,
      accessToken: 'token',
      draft: options.draft ?? draft,
      originalIdentifierValues: options.originalIdentifiers ?? new Set(),
      originalPictureIds: options.originalPictures ?? new Set(),
    };
    const sourceService = {
      load: jest.fn().mockResolvedValue(source),
      sellerUsesUserProducts: jest.fn().mockResolvedValue(options.sellerUsesUp),
    };
    const apiService = {
      get: jest
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve(
            path.endsWith('/attributes')
              ? [{ id: 'BRAND', tags: { required: true } }]
              : { id: 'MLA1', settings: { listing_allowed: true } },
          ),
        ),
      post: jest.fn(),
      put: jest.fn(),
    };
    return {
      apiService,
      service: new SimilarPublicationCreationService(
        sourceService as never,
        new SimilarPublicationValidationService(apiService as never),
        apiService as never,
      ),
    };
  }
});

function safeMockCall(mock: jest.Mock, index: number): [unknown, unknown] {
  const value: unknown = mock.mock.calls[index];
  if (!Array.isArray(value)) throw new Error('Mock call inválido');
  return [value[0] as unknown, value[1] as unknown];
}
