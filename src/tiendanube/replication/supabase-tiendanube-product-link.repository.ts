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
  SourceLink,
  SourceReservation,
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

  async findBySourceKey(input: {
    userId: string;
    storeId: string;
    sourceKey: string;
  }): Promise<SourceLink | null> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .from('tiendanube_product_links')
        .select('ml_source_key,tiendanube_product_id,status')
        .eq('user_id', input.userId)
        .eq('store_id', input.storeId)
        .eq('ml_source_key', input.sourceKey)
        .maybeSingle();
      if (error) this.sourceLinkError();
      if (!data) return null;
      if (
        typeof data.ml_source_key !== 'string' ||
        !['PENDING', 'FAILED', 'COMPLETED'].includes(data.status)
      )
        this.sourceLinkError();
      if (
        data.status === 'COMPLETED' &&
        (typeof data.tiendanube_product_id !== 'string' ||
          !/^[1-9]\d*$/u.test(data.tiendanube_product_id))
      )
        this.sourceLinkError();
      if (data.status !== 'COMPLETED' && data.tiendanube_product_id !== null)
        this.sourceLinkError();
      const tiendanubeProductId = data.tiendanube_product_id;
      return {
        sourceKey: data.ml_source_key,
        tiendanubeProductId,
        status: data.status,
      };
    } catch {
      this.sourceLinkError();
    }
  }

  async reserveBySource(input: {
    userId: string;
    storeId: string;
    sourceKey: string;
  }): Promise<SourceReservation> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('reserve_tiendanube_product_link_by_source', {
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_source_key: input.sourceKey,
        });
      if (error || !data || data.length !== 1) this.sourceLinkError();
      return this.mapSourceReservation(data[0]);
    } catch {
      this.sourceLinkError();
    }
  }

  async completeBySource(input: {
    linkId: string;
    userId: string;
    storeId: string;
    sourceKey: string;
    reservationVersion: string;
    tiendanubeProductId: string;
  }): Promise<void> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('complete_tiendanube_product_link_by_source', {
          p_link_id: input.linkId,
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_source_key: input.sourceKey,
          p_reservation_version: input.reservationVersion,
          p_tiendanube_product_id: input.tiendanubeProductId,
        });
      if (error || data !== true) this.sourceLinkError();
    } catch {
      this.sourceLinkError();
    }
  }

  async failBySource(input: {
    linkId: string;
    userId: string;
    storeId: string;
    sourceKey: string;
    reservationVersion: string;
  }): Promise<void> {
    try {
      const { data, error } = await this.supabaseService
        .getClient()
        .rpc('fail_tiendanube_product_link_by_source', {
          p_link_id: input.linkId,
          p_user_id: input.userId,
          p_store_id: input.storeId,
          p_ml_source_key: input.sourceKey,
          p_reservation_version: input.reservationVersion,
        });
      if (error || data !== true) this.sourceLinkError();
    } catch {
      this.sourceLinkError();
    }
  }

  async saveSourceLink(input: {
    userId: string;
    storeId: string;
    sourceKey: string;
    tiendanubeProductId: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabaseService
        .getClient()
        .from('tiendanube_product_links')
        .upsert(
          {
            user_id: input.userId,
            store_id: input.storeId,
            ml_source_key: input.sourceKey,
            tiendanube_product_id: input.tiendanubeProductId,
            status: 'COMPLETED',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,store_id,ml_source_key' },
        );
      if (error) this.sourceLinkError();
    } catch {
      this.sourceLinkError();
    }
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

  private sourceLinkError(): never {
    throw new ServiceUnavailableException(
      'No se pudo leer o guardar el vínculo de Tiendanube',
    );
  }

  private mapSourceReservation(row: ReserveRpcRow): SourceReservation {
    if (row.outcome === 'PENDING' && row.link_status === 'PENDING')
      return { outcome: 'PENDING' };
    if (
      row.outcome === 'COMPLETED' &&
      row.link_status === 'COMPLETED' &&
      typeof row.tiendanube_product_id === 'string'
    ) {
      return {
        outcome: 'COMPLETED',
        tiendanubeProductId: row.tiendanube_product_id,
      };
    }
    if (
      row.outcome === 'RESERVED' &&
      row.link_status === 'PENDING' &&
      typeof row.link_id === 'string' &&
      typeof row.reservation_version === 'string'
    ) {
      return {
        outcome: 'RESERVED',
        linkId: row.link_id,
        reservationVersion: row.reservation_version,
      };
    }
    this.sourceLinkError();
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
