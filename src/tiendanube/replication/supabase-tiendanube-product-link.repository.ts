import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { Database } from '../../database/database.types';
import { SupabaseService } from '../../database/supabase.service';
import type {
  CompleteTiendanubeProductLinkInput,
  FailTiendanubeProductLinkInput,
  Reservation,
  ReserveTiendanubeProductLinkInput,
} from './tiendanube-product-link.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';

type ReserveRpcRow =
  Database['public']['Functions']['reserve_tiendanube_product_link']['Returns'][number];

const TIENDANUBE_PRODUCT_ID_PATTERN = /^[1-9][0-9]*$/u;

@Injectable()
export class SupabaseTiendanubeProductLinkRepository extends TiendanubeProductLinkRepository {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  async reserve(
    input: ReserveTiendanubeProductLinkInput,
  ): Promise<Reservation> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('reserve_tiendanube_product_link', {
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_product_id: input.mlProductId,
          p_ml_source_key: input.mlSourceKey,
        });

      if (error || !data || data.length !== 1) this.reserveError();
      return this.mapReservation(data[0]);
    } catch {
      this.reserveError();
    }
  }

  async complete(input: CompleteTiendanubeProductLinkInput): Promise<void> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('complete_tiendanube_product_link', {
          p_link_id: input.linkId,
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_product_id: input.mlProductId,
          p_ml_source_key: input.mlSourceKey,
          p_reservation_version: input.reservationVersion,
          p_tiendanube_product_id: input.tiendanubeProductId,
        });

      if (error || data !== true) this.completeError();
    } catch {
      this.completeError();
    }
  }

  async fail(input: FailTiendanubeProductLinkInput): Promise<void> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('fail_tiendanube_product_link', {
          p_link_id: input.linkId,
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_product_id: input.mlProductId,
          p_ml_source_key: input.mlSourceKey,
          p_reservation_version: input.reservationVersion,
        });

      if (error || data !== true) this.failError();
    } catch {
      this.failError();
    }
  }

  private mapReservation(row: ReserveRpcRow): Reservation {
    if (!row.link_id.trim()) this.reserveError();

    if (
      row.outcome === 'RESERVED' &&
      row.link_status === 'PENDING' &&
      row.tiendanube_product_id === null &&
      isIsoTimestamp(row.reservation_version)
    ) {
      return {
        outcome: 'RESERVED',
        linkId: row.link_id,
        reservationVersion: row.reservation_version,
      };
    }

    if (
      row.outcome === 'PENDING' &&
      row.link_status === 'PENDING' &&
      row.tiendanube_product_id === null &&
      row.reservation_version === null
    ) {
      return { outcome: 'PENDING' };
    }

    if (
      row.outcome === 'COMPLETED' &&
      row.link_status === 'COMPLETED' &&
      typeof row.tiendanube_product_id === 'string' &&
      TIENDANUBE_PRODUCT_ID_PATTERN.test(row.tiendanube_product_id) &&
      row.reservation_version === null
    ) {
      return {
        outcome: 'COMPLETED',
        tiendanubeProductId: row.tiendanube_product_id,
      };
    }

    this.reserveError();
  }

  private reserveError(): never {
    throw new ServiceUnavailableException(
      'No se pudo reservar la replicación en Tiendanube',
    );
  }

  private completeError(): never {
    throw new ServiceUnavailableException(
      'No se pudo confirmar la replicación en Tiendanube',
    );
  }

  private failError(): never {
    throw new ServiceUnavailableException(
      'No se pudo registrar el fallo de replicación en Tiendanube',
    );
  }
}

function isIsoTimestamp(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}
