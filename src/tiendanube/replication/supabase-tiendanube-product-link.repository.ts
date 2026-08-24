import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { Database } from '../../database/database.types';
import { SupabaseService } from '../../database/supabase.service';
import type {
  CompleteTiendanubeProductLinkInput,
  FailTiendanubeProductLinkInput,
  FindTiendanubeProductLinkStatusesInput,
  Reservation,
  ReserveTiendanubeProductLinkInput,
  TiendanubeProductLinkStatusRecord,
} from './tiendanube-product-link.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';

type ReserveRpcRow =
  Database['public']['Functions']['reserve_tiendanube_product_link']['Returns'][number];

const TIENDANUBE_PRODUCT_ID_PATTERN = /^[1-9][0-9]*$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

  async findStatusesByMlProductIds(
    input: FindTiendanubeProductLinkStatusesInput,
  ): Promise<readonly TiendanubeProductLinkStatusRecord[]> {
    const requestedIds = [...input.mlProductIds];
    if (requestedIds.length === 0) return [];
    if (new Set(requestedIds).size !== requestedIds.length) {
      this.statusReadError();
    }

    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('tiendanube_product_links')
        .select('ml_product_id,status,tiendanube_product_id')
        .eq('user_id', input.userId)
        .eq('store_id', input.storeId)
        .in('ml_product_id', requestedIds);

      if (error || data === null) this.statusReadError();
      return this.mapStatusRows(data, requestedIds);
    } catch {
      this.statusReadError();
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

  private mapStatusRows(
    value: unknown,
    requestedIds: readonly string[],
  ): readonly TiendanubeProductLinkStatusRecord[] {
    if (!Array.isArray(value)) this.statusReadError();

    const requestedIdSet = new Set(requestedIds);
    const recordsByProductId = new Map<
      string,
      TiendanubeProductLinkStatusRecord
    >();

    for (const row of value) {
      if (!isObject(row)) this.statusReadError();

      const mlProductId = row.ml_product_id;
      const status = row.status;
      const tiendanubeProductId = row.tiendanube_product_id;

      if (
        typeof mlProductId !== 'string' ||
        !UUID_PATTERN.test(mlProductId) ||
        !requestedIdSet.has(mlProductId) ||
        !isProductLinkStatus(status) ||
        !isValidTiendanubeProductId(status, tiendanubeProductId) ||
        recordsByProductId.has(mlProductId)
      ) {
        this.statusReadError();
      }

      recordsByProductId.set(mlProductId, {
        mlProductId,
        status,
        tiendanubeProductId,
      });
    }

    return requestedIds.flatMap((mlProductId) => {
      const record = recordsByProductId.get(mlProductId);
      return record ? [record] : [];
    });
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

  private statusReadError(): never {
    throw new ServiceUnavailableException(
      'No se pudo consultar el estado de las replicaciones en Tiendanube',
    );
  }
}

function isIsoTimestamp(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProductLinkStatus(
  value: unknown,
): value is TiendanubeProductLinkStatusRecord['status'] {
  return value === 'PENDING' || value === 'FAILED' || value === 'COMPLETED';
}

function isValidTiendanubeProductId(
  status: TiendanubeProductLinkStatusRecord['status'],
  value: unknown,
): value is string | null {
  if (status === 'COMPLETED') {
    return (
      typeof value === 'string' && TIENDANUBE_PRODUCT_ID_PATTERN.test(value)
    );
  }

  return value === null;
}
