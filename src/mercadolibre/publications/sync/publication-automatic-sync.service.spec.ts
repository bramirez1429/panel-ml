import { MercadolibreSyncJobsRepository } from '../../../database/repositories/mercadolibre-sync-jobs.repository';
import { SupabaseService } from '../../../database/supabase.service';
import {
  isDue,
  PublicationAutomaticSyncService,
} from './publication-automatic-sync.service';
import { PublicationSyncJobService } from './publication-sync-job.service';
import { PublicationSyncDispatcherService } from './publication-sync-dispatcher.service';

describe('PublicationAutomaticSyncService', () => {
  it('inicia una sola vez por seller cuando pasaron 96 horas', async () => {
    const connections = [
      { user_id: 'user-a', seller_id: 123 },
      { user_id: 'user-b', seller_id: 123 },
      { user_id: 'user-c', seller_id: 456 },
    ];
    const supabase = {
      getAllMercadoLibreConnections: jest.fn().mockResolvedValue(connections),
    };
    const jobs = {
      findLatestBySellerId: jest
        .fn()
        .mockResolvedValueOnce({ finished_at: '2026-09-20T00:00:00.000Z' })
        .mockResolvedValueOnce({ finished_at: '2026-09-24T00:00:00.000Z' }),
    };
    const syncJobs = {
      start: jest.fn().mockResolvedValue({
        syncId: 'sync-1',
        status: 'PENDING',
        created: true,
      }),
    };
    const queue = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const service = new PublicationAutomaticSyncService(
      supabase as unknown as SupabaseService,
      jobs as unknown as MercadolibreSyncJobsRepository,
      syncJobs as unknown as PublicationSyncJobService,
      queue as unknown as PublicationSyncDispatcherService,
    );

    await expect(
      service.run(new Date('2026-09-25T00:00:00.000Z')),
    ).resolves.toEqual({
      checkedSellers: 2,
      started: 1,
    });
    expect(syncJobs.start).toHaveBeenCalledWith('user-a');
    expect(syncJobs.start).not.toHaveBeenCalledWith('user-b');
    expect(queue.dispatch).toHaveBeenCalledWith('user-a', 'sync-1');
  });

  it('considera due solamente desde las 96 horas y si nunca hubo sync', () => {
    const now = new Date('2026-09-25T12:00:00.000Z');
    expect(isDue(null, now)).toBe(true);
    expect(isDue('2026-09-21T12:00:01.000Z', now)).toBe(false);
    expect(isDue('2026-09-21T12:00:00.000Z', now)).toBe(true);
  });
});
