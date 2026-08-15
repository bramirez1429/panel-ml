import { ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MercadolibreChildrenRepository } from './mercadolibre-children.repository';

describe('MercadolibreChildrenRepository updatePrice', () => {
  const eq = jest.fn();
  const update = jest.fn();
  const from = jest.fn();

  let repository: MercadolibreChildrenRepository;

  beforeEach(() => {
    jest.clearAllMocks();

    eq.mockResolvedValue({ error: null });

    update.mockReturnValue({
      eq,
    });

    from.mockReturnValue({
      update,
    });

    repository = new MercadolibreChildrenRepository({
      getClient: () => ({
        from,
      }),
    } as unknown as SupabaseService);
  });

  it('actualiza el precio de la variante', async () => {
    await repository.updatePrice(
      'MLA123456789',
      50000,
    );

    expect(from).toHaveBeenCalledWith(
      'mercadolibre_product_children',
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 50000,
        updated_at: expect.any(String),
      }),
    );

    expect(eq).toHaveBeenCalledWith(
      'item_id',
      'MLA123456789',
    );
  });

  it('lanza error si Supabase falla', async () => {
    eq.mockResolvedValue({
      error: { message: 'error database' },
    });

    await expect(
      repository.updatePrice(
        'MLA123456789',
        50000,
      ),
    ).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});