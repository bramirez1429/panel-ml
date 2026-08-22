import { ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../supabase.service';
import { MercadolibreChildrenRepository } from './mercadolibre-children.repository';

describe('MercadolibreChildrenRepository updatePrice', () => {
  const eq = jest.fn();
  let updatedValues: Record<string, unknown> | undefined;
  const update = jest.fn((values: Record<string, unknown>) => {
    updatedValues = values;
    return { eq };
  });
  const from = jest.fn();

  let repository: MercadolibreChildrenRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    updatedValues = undefined;

    eq.mockResolvedValue({ error: null });

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
    await repository.updatePrice('MLA123456789', 50000);

    expect(from).toHaveBeenCalledWith('mercadolibre_product_children');

    expect(updatedValues?.price).toBe(50000);
    expect(typeof updatedValues?.updated_at).toBe('string');

    expect(eq).toHaveBeenCalledWith('item_id', 'MLA123456789');
  });

  it('lanza error si Supabase falla', async () => {
    eq.mockResolvedValue({
      error: { message: 'error database' },
    });

    await expect(
      repository.updatePrice('MLA123456789', 50000),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
