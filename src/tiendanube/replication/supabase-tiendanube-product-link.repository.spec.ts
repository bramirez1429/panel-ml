import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../database/database.types';
import type { SupabaseService } from '../../database/supabase.service';
import { SupabaseTiendanubeProductLinkRepository } from './supabase-tiendanube-product-link.repository';
import type {
  CompleteTiendanubeProductLinkInput,
  FailTiendanubeProductLinkInput,
  ReserveTiendanubeProductLinkInput,
} from './tiendanube-product-link.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const LINK_ID = '22222222-2222-4222-8222-222222222222';
const ML_PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const STORE_ID = '987654';
const SOURCE_KEY = 'family:MLA-UP-123';
const RESERVATION_VERSION = '2026-08-24T18:00:00.000Z';
const TIENDANUBE_PRODUCT_ID = '456789';
const SECRET_MARKER = 'private-tiendanube-access-token';

const RESERVE_INPUT: ReserveTiendanubeProductLinkInput = {
  userId: USER_ID,
  storeId: STORE_ID,
  mlProductId: ML_PRODUCT_ID,
  mlSourceKey: SOURCE_KEY,
};

const COMPLETE_INPUT: CompleteTiendanubeProductLinkInput = {
  linkId: LINK_ID,
  ...RESERVE_INPUT,
  reservationVersion: RESERVATION_VERSION,
  tiendanubeProductId: TIENDANUBE_PRODUCT_ID,
};

const FAIL_INPUT: FailTiendanubeProductLinkInput = {
  linkId: LINK_ID,
  ...RESERVE_INPUT,
  reservationVersion: RESERVATION_VERSION,
};

function setupRepository(data: unknown, error: unknown = null) {
  const rpc = jest.fn().mockResolvedValue({ data, error });
  const client = { rpc } as unknown as SupabaseClient<Database>;
  const supabase = {
    getClient: jest.fn().mockReturnValue(client),
  } as unknown as SupabaseService;

  return {
    repository: new SupabaseTiendanubeProductLinkRepository(supabase),
    rpc,
  };
}

describe('SupabaseTiendanubeProductLinkRepository', () => {
  it('reserva atómicamente una relación nueva', async () => {
    const { repository, rpc } = setupRepository([
      {
        outcome: 'RESERVED',
        link_id: LINK_ID,
        link_status: 'PENDING',
        tiendanube_product_id: null,
        reservation_version: RESERVATION_VERSION,
        access_token: SECRET_MARKER,
      },
    ]);

    const result = await repository.reserve(RESERVE_INPUT);

    expect(result).toEqual({
      outcome: 'RESERVED',
      linkId: LINK_ID,
      reservationVersion: RESERVATION_VERSION,
    });
    expect(rpc).toHaveBeenCalledWith('reserve_tiendanube_product_link', {
      p_user_id: USER_ID,
      p_store_id: STORE_ID,
      p_ml_product_id: ML_PRODUCT_ID,
      p_ml_source_key: SOURCE_KEY,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
  });

  it('informa PENDING sin entregar el identificador ni la versión de otra reserva', async () => {
    const { repository } = setupRepository([
      {
        outcome: 'PENDING',
        link_id: LINK_ID,
        link_status: 'PENDING',
        tiendanube_product_id: null,
        reservation_version: null,
      },
    ]);

    await expect(repository.reserve(RESERVE_INPUT)).resolves.toEqual({
      outcome: 'PENDING',
    });
  });

  it('devuelve el producto existente para una relación COMPLETED', async () => {
    const { repository } = setupRepository([
      {
        outcome: 'COMPLETED',
        link_id: LINK_ID,
        link_status: 'COMPLETED',
        tiendanube_product_id: TIENDANUBE_PRODUCT_ID,
        reservation_version: null,
      },
    ]);

    await expect(repository.reserve(RESERVE_INPUT)).resolves.toEqual({
      outcome: 'COMPLETED',
      tiendanubeProductId: TIENDANUBE_PRODUCT_ID,
    });
  });

  it('mapea como RESERVED la reserva RPC que recuperó atómicamente un FAILED', async () => {
    const retryVersion = '2026-08-24T18:05:00.000Z';
    const { repository } = setupRepository([
      {
        outcome: 'RESERVED',
        link_id: LINK_ID,
        link_status: 'PENDING',
        tiendanube_product_id: null,
        reservation_version: retryVersion,
      },
    ]);

    await expect(repository.reserve(RESERVE_INPUT)).resolves.toEqual({
      outcome: 'RESERVED',
      linkId: LINK_ID,
      reservationVersion: retryVersion,
    });
  });

  it('completa mediante CAS usando toda la identidad de la reserva', async () => {
    const { repository, rpc } = setupRepository(true);

    await expect(repository.complete(COMPLETE_INPUT)).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('complete_tiendanube_product_link', {
      p_link_id: LINK_ID,
      p_user_id: USER_ID,
      p_store_id: STORE_ID,
      p_ml_product_id: ML_PRODUCT_ID,
      p_ml_source_key: SOURCE_KEY,
      p_reservation_version: RESERVATION_VERSION,
      p_tiendanube_product_id: TIENDANUBE_PRODUCT_ID,
    });
  });

  it('falla mediante CAS usando toda la identidad de la reserva', async () => {
    const { repository, rpc } = setupRepository(true);

    await expect(repository.fail(FAIL_INPUT)).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('fail_tiendanube_product_link', {
      p_link_id: LINK_ID,
      p_user_id: USER_ID,
      p_store_id: STORE_ID,
      p_ml_product_id: ML_PRODUCT_ID,
      p_ml_source_key: SOURCE_KEY,
      p_reservation_version: RESERVATION_VERSION,
    });
  });

  it('rechaza una transición CAS perdida al completar', async () => {
    const { repository } = setupRepository(false);

    await expect(repository.complete(COMPLETE_INPUT)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rechaza una transición CAS perdida al registrar un fallo', async () => {
    const { repository } = setupRepository(false);

    await expect(repository.fail(FAIL_INPUT)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rechaza respuestas de reserva inconsistentes', async () => {
    const { repository } = setupRepository([
      {
        outcome: 'COMPLETED',
        link_id: LINK_ID,
        link_status: 'COMPLETED',
        tiendanube_product_id: null,
        reservation_version: RESERVATION_VERSION,
      },
    ]);

    await expect(repository.reserve(RESERVE_INPUT)).rejects.toMatchObject({
      status: 503,
      message: 'No se pudo reservar la replicación en Tiendanube',
    });
  });

  it.each<{
    name: string;
    invoke: (
      repository: SupabaseTiendanubeProductLinkRepository,
    ) => Promise<unknown>;
  }>([
    {
      name: 'reserve',
      invoke: (repository) => repository.reserve(RESERVE_INPUT),
    },
    {
      name: 'complete',
      invoke: (repository) => repository.complete(COMPLETE_INPUT),
    },
    {
      name: 'fail',
      invoke: (repository) => repository.fail(FAIL_INPUT),
    },
  ])(
    'oculta detalles sensibles cuando Supabase falla en $name',
    async ({ invoke }) => {
      const { repository } = setupRepository(null, {
        message: `database failure containing ${SECRET_MARKER}`,
      });

      let caught: unknown;
      try {
        await invoke(repository);
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({ status: 503 });
      expect(JSON.stringify(caught)).not.toContain(SECRET_MARKER);
    },
  );
});
