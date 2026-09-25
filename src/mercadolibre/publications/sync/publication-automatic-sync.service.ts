import { Injectable } from '@nestjs/common';
import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { SupabaseService } from '../../../database/supabase.service';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncDispatcherService } from './publication-sync-dispatcher.service';
import { AUTOMATIC_SYNC_INTERVAL_MS } from './publication-sync-overview.service';

@Injectable()
export class PublicationAutomaticSyncService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly jobs: MercadolibreSyncJobsRepository,
    private readonly syncJobs: PublicationSyncJobService,
    private readonly dispatcher: PublicationSyncDispatcherService,
  ) {}

  async run(now = new Date()) {
    const connections = await this.supabase.getAllMercadoLibreConnections();
    const unique = new Map<number, (typeof connections)[number]>();
    for (const connection of connections) {
      if (!unique.has(connection.seller_id)) {
        unique.set(connection.seller_id, connection);
      }
    }

    let started = 0;
    for (const connection of unique.values()) {
      const latest = await this.jobs.findLatestBySellerId(
        connection.seller_id,
        ['COMPLETED'],
      );
      if (!isDue(latest?.finished_at ?? null, now)) continue;
      const result = await this.syncJobs.start(connection.user_id);
      if (!result.created) continue;
      await this.dispatcher.dispatch(connection.user_id, result.syncId);
      started += 1;
    }
    return { checkedSellers: unique.size, started };
  }
}

export function isDue(lastSuccessfulAt: string | null, now: Date): boolean {
  if (!lastSuccessfulAt) return true;
  return (
    now.getTime() - Date.parse(lastSuccessfulAt) >= AUTOMATIC_SYNC_INTERVAL_MS
  );
}
