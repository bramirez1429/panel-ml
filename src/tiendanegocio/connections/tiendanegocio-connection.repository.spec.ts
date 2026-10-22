import { ServiceUnavailableException } from '@nestjs/common';

import type { SupabaseService } from '../../database/supabase.service';
import { TiendaNegocioConnectionRepository } from './tiendanegocio-connection.repository';

describe('TiendaNegocioConnectionRepository', () => {
  it('devuelve null cuando no existe conexión para el usuario autenticado', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const repository = createRepository(from);

    await expect(repository.get('user-1')).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('tiendanegocio_connections');
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('expone un 503 seguro cuando Supabase no puede consultar la conexión', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '', message: 'fetch failed' },
    });
    const repository = createRepository(
      jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({ maybeSingle }),
        }),
      }),
    );

    await expect(repository.get('user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

function createRepository(from: jest.Mock): TiendaNegocioConnectionRepository {
  return new TiendaNegocioConnectionRepository({
    getClient: jest.fn().mockReturnValue({ from }),
  } as unknown as SupabaseService);
}
