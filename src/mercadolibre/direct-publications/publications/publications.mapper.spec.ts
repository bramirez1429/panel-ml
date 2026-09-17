import { PublicationsMapper } from './publications.mapper';

describe('PublicationsMapper listing summaries', () => {
  it('keeps LEGACY aggregates and count without returning variation details', () => {
    const result = PublicationsMapper.toSharedProduct({
      id: 'MLA123',
      title: 'Remera',
      price: 1200,
      currency_id: 'ARS',
      available_quantity: 7,
      sold_quantity: 3,
      status: 'active',
      thumbnail: 'https://example.com/image.jpg',
      permalink: 'https://example.com/MLA123',
      variations: [{ id: 1 }, { id: 2 }],
    });

    expect(result).toMatchObject({
      model: 'SHARED',
      itemId: 'MLA123',
      stock: 7,
      sold: 3,
      variantsCount: 2,
      currency: 'ARS',
    });
    expect(result).not.toHaveProperty('variations');
  });
});
