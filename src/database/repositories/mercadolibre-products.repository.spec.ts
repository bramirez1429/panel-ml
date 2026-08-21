import { ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MercadolibreProductsRepository } from './mercadolibre-products.repository';

describe('MercadolibreProductsRepository updatePrice', () => {
  const eq = jest.fn();
  const update = jest.fn();
  const from = jest.fn();

  let repository: MercadolibreProductsRepository;

  beforeEach(() => {
    jest.clearAllMocks();

    eq.mockResolvedValue({ error: null });

    update.mockReturnValue({
      eq,
    });

    from.mockReturnValue({
      update,
    });

    repository = new MercadolibreProductsRepository({
      getClient: () => ({
        from,
      }),
    } as unknown as SupabaseService);
  });

  it('actualiza el precio del producto', async () => {
    await repository.updatePrice('123e4567-e89b-42d3-a456-426614174000', 45000);

    expect(from).toHaveBeenCalledWith('mercadolibre_products');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        price_from: 45000,
        price_to: 45000,
        updated_at: expect.any(String),
      }),
    );

    expect(eq).toHaveBeenCalledWith(
      'id',
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('lanza error si Supabase falla', async () => {
    eq.mockResolvedValue({
      error: { message: 'error database' },
    });

    await expect(
      repository.updatePrice('123e4567-e89b-42d3-a456-426614174000', 45000),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
