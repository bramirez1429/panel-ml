import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { ItemsService } from './items.service';
import { ItemUpdateService } from './item-update.service';

describe('ItemUpdateService publication status safety', () => {
  it.each(['active', 'paused'] as const)(
    'actualiza el precio clásico %s sin enviar status y aplica todas las variantes',
    async (status) => {
      const item = { id: 'MLA1', status, variations: [{ id: 1 }, { id: 2 }] };
      const api = { put: jest.fn().mockResolvedValue(item) };
      const service = new ItemUpdateService(
        { getValidAccessToken: jest.fn().mockResolvedValue('token') } as unknown as MercadolibreTokenService,
        api as unknown as MercadolibreApiService,
        { getOne: jest.fn().mockResolvedValue(item) } as unknown as ItemsService,
      );
      await service.updateClassic('user', 'MLA1', { price: 200 });
      expect(api.put).toHaveBeenCalledWith('/items/MLA1', { variations: [{ id: 1, price: 200 }, { id: 2, price: 200 }] }, 'token');
    },
  );

  it('rechaza precio para una publicación cerrada antes de escribir', async () => {
    const api = { put: jest.fn() };
    const service = new ItemUpdateService(
      { getValidAccessToken: jest.fn().mockResolvedValue('token') } as unknown as MercadolibreTokenService,
      api as unknown as MercadolibreApiService,
      { getOne: jest.fn().mockResolvedValue({ id: 'MLA1', status: 'closed' }) } as unknown as ItemsService,
    );
    await expect(service.updateClassic('user', 'MLA1', { price: 200 })).rejects.toHaveProperty('status', 400);
    expect(api.put).not.toHaveBeenCalled();
  });
});
