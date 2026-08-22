import { ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MercadolibreProductsRepository } from './mercadolibre-products.repository';

describe('MercadolibreProductsRepository updatePrice', () => {
  const eq = jest.fn();
  let updatedValues: Record<string, unknown> | undefined;
  const update = jest.fn((values: Record<string, unknown>) => {
    updatedValues = values;
    return { eq };
  });
  const from = jest.fn();

  let repository: MercadolibreProductsRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    updatedValues = undefined;

    eq.mockResolvedValue({ error: null });

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

    expect(updatedValues?.price_from).toBe(45000);
    expect(updatedValues?.price_to).toBe(45000);
    expect(typeof updatedValues?.updated_at).toBe('string');

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
