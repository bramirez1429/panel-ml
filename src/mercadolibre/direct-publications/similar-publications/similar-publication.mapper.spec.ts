import { SimilarPublicationDraftMapper } from './similar-publication.mapper';

describe('SimilarPublicationDraftMapper', () => {
  const mapper = new SimilarPublicationDraftMapper();

  it('construye el draft por allowlist y limpia imágenes e identificadores', () => {
    const draft = mapper.map({
      sourceKey: 'item:MLA123',
      sourceType: 'LEGACY',
      description: 'Descripción reusable',
      items: [
        {
          id: 'MLA123',
          seller_id: 99,
          title: 'Remera original',
          category_id: 'MLA1',
          price: 1000,
          currency_id: 'ARS',
          listing_type_id: 'gold_special',
          buying_mode: 'buy_it_now',
          available_quantity: 5,
          sold_quantity: 8,
          family_id: 123,
          user_product_id: 'MLAU123',
          inventory_id: 'INV-SECRET',
          thumbnail: 'https://original/thumbnail.jpg',
          pictures: [{ id: 'OLD-PICTURE', secure_url: 'https://original.jpg' }],
          catalog_product_id: null,
          promotions: [{ id: 'PROMO' }],
          attributes: [
            { id: 'BRAND', name: 'Marca', value_name: 'Acme' },
            { id: 'SELLER_SKU', name: 'SKU', value_name: 'OLD-SKU' },
            { id: 'GTIN', name: 'EAN', value_name: '7790000000000' },
          ],
          variations: [
            {
              id: 987,
              price: 1200,
              available_quantity: 3,
              picture_ids: ['OLD-PICTURE'],
              attribute_combinations: [
                { id: 'COLOR', name: 'Color', value_name: 'Rojo' },
              ],
            },
          ],
        },
      ],
    });

    expect(draft).toMatchObject({
      categoryId: 'MLA1',
      description: 'Descripción reusable',
      variants: [{ price: 1200, stock: 3, sku: null, pictureIds: [] }],
      pictures: [],
    });
    expect(draft.variants[0].attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'BRAND', valueName: 'Acme' }),
        expect.objectContaining({ id: 'COLOR', valueName: 'Rojo' }),
        expect.objectContaining({
          id: 'SELLER_SKU',
          valueName: null,
          values: [],
        }),
        expect.objectContaining({ id: 'GTIN', valueName: null, values: [] }),
      ]),
    );
    const serialized = JSON.stringify(draft);
    for (const forbidden of [
      'thumbnail',
      'OLD-PICTURE',
      'INV-SECRET',
      'sold_quantity',
      'PROMO',
      'OLD-SKU',
      '7790000000000',
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it('copia la estructura UP sin IDs internos', () => {
    const draft = mapper.map({
      sourceKey: 'family:55',
      sourceType: 'USER_PRODUCT',
      description: null,
      items: [
        {
          id: 'MLA1',
          user_product_id: 'MLAU1',
          family_id: 55,
          family_name: 'Original',
          title: 'Rojo',
          category_id: 'MLA2',
          price: 500,
          available_quantity: 2,
          currency_id: 'ARS',
          listing_type_id: 'gold_special',
          buying_mode: 'buy_it_now',
        },
        {
          id: 'MLA2',
          user_product_id: 'MLAU2',
          family_id: 55,
          family_name: 'Original',
          title: 'Azul',
          category_id: 'MLA2',
          price: 600,
          available_quantity: 4,
          currency_id: 'ARS',
          listing_type_id: 'gold_special',
          buying_mode: 'buy_it_now',
        },
      ],
      userProducts: [
        { id: 'MLAU1', attributes: [{ id: 'COLOR', value_name: 'Rojo' }] },
        { id: 'MLAU2', attributes: [{ id: 'COLOR', value_name: 'Azul' }] },
      ],
    });

    expect(draft.variants.map(({ price }) => price)).toEqual([500, 600]);
    expect(JSON.stringify(draft)).not.toContain('MLAU');
    expect(JSON.stringify(draft)).not.toContain('familyId');
  });
});
