import { SupabaseService } from '../database/supabase.service';
import { SupabaseVariantChannelLinksRepository } from './supabase-variant-channel-links.repository';

describe('SupabaseVariantChannelLinksRepository', () => {
  it('busca vínculos por usuario, publicación y variación cuando se informa', async () => {
    const row = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user_id: '11111111-1111-4111-8111-111111111111',
      ml_item_id: 'MLA1491447379',
      ml_variation_id: '123456789',
      user_product_id: 'MLAU123',
      family_id: '7452953254396627',
      tn_product_id: '1001',
      tn_variant_id: '1101',
      sku: 'TN-SKU-1101',
      normalized_color: null,
      normalized_size: null,
      match_source: 'MANUAL' as const,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    };
    const variationEq = jest.fn().mockResolvedValue({ data: [row], error: null });
    const itemEq = jest.fn().mockReturnValue({ eq: variationEq });
    const userEq = jest.fn().mockReturnValue({ eq: itemEq });
    const select = jest.fn().mockReturnValue({ eq: userEq });
    const from = jest.fn().mockReturnValue({ select });
    const repository = new SupabaseVariantChannelLinksRepository({
      getClient: jest.fn().mockReturnValue({ from }),
    } as unknown as SupabaseService);

    await expect(
      repository.findByUserIdAndMlItemId(
        row.user_id,
        row.ml_item_id,
        row.ml_variation_id,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        userId: row.user_id,
        mlItemId: row.ml_item_id,
        mlVariationId: row.ml_variation_id,
        tnProductId: row.tn_product_id,
        tnVariantId: row.tn_variant_id,
      }),
    ]);

    expect(from).toHaveBeenCalledWith('variant_channel_links');
    expect(userEq).toHaveBeenCalledWith('user_id', row.user_id);
    expect(itemEq).toHaveBeenCalledWith('ml_item_id', row.ml_item_id);
    expect(variationEq).toHaveBeenCalledWith(
      'ml_variation_id',
      row.ml_variation_id,
    );
  });
});
