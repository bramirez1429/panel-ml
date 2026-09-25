import { PublicationSyncOverviewService } from './publication-sync-overview.service';

describe('PublicationSyncOverviewService', () => {
  it('calcula porcentaje con procesados y expone contadores abiertos', async () => {
    const active = {
      id: 'job',
      status: 'RUNNING',
      total_items: 250,
      processed_items: 145,
      successful_items: 141,
      failed_items: 4,
      started_at: '2026-09-25T10:00:00.000Z',
    };
    const latest = {
      ...active,
      status: 'COMPLETED_WITH_ERRORS',
      finished_at: '2026-09-25T11:00:00.000Z',
    };
    const successful = {
      ...latest,
      status: 'COMPLETED',
      finished_at: '2026-09-21T12:00:00.000Z',
    };
    const jobs = {
      findActiveBySellerId: jest.fn().mockResolvedValue(active),
      findLatestBySellerId: jest
        .fn()
        .mockResolvedValueOnce(latest)
        .mockResolvedValueOnce(successful),
    };
    const service = new PublicationSyncOverviewService(
      jobs as never,
      { countOpen: jest.fn().mockResolvedValue(4) } as never,
      { countOpen: jest.fn().mockResolvedValue(2) } as never,
      {
        getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 123 }),
      } as never,
    );

    await expect(service.getOverview('user')).resolves.toMatchObject({
      activeSync: {
        totalItems: 250,
        processedItems: 145,
        successfulItems: 141,
        failedItems: 4,
        percent: 58,
      },
      openErrorsCount: 4,
      openIntegrationEventsCount: 2,
      nextAutomaticSyncAt: '2026-09-25T12:00:00.000Z',
    });
  });
});
