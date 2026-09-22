import type { SafeUser } from '../../../auth/domain/auth.models';
import type { StockBulkDispatcher } from './stock-bulk-dispatcher';
import type { StockBulkJobService } from './stock-bulk-job.service';
import type { StockBulkPreviewService } from './stock-bulk-preview.service';
import { StockBulkController } from './stock-bulk.controller';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
} as SafeUser;
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const TARGET = {
  identifier: 'MLA1',
  title: null,
  color: null,
  size: '40',
  itemId: 'MLA1',
  userProductId: null,
  variationId: null,
  familyId: null,
  model: 'LEGACY',
  currentQuantity: 0,
  requestedQuantity: 2,
  currentStatus: 'active',
  needsChange: true,
  editable: true,
};

describe('StockBulkController', () => {
  it('persiste el job, inicia el dispatcher y devuelve el jobId', async () => {
    const dependencies = setup();

    await expect(
      dependencies.controller.startJob(USER, { targets: [TARGET] }),
    ).resolves.toEqual({ jobId: JOB_ID, status: 'QUEUED', totalItems: 1 });

    expect(dependencies.jobs.start).toHaveBeenCalledWith(USER.id, [TARGET]);
    expect(dependencies.dispatcher.dispatch).toHaveBeenCalledWith({
      userId: USER.id,
      jobId: JOB_ID,
    });
    expect(dependencies.jobs.start.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.dispatcher.dispatch.mock.invocationCallOrder[0],
    );
  });

  it('devuelve jobId y causa segura si el dispatcher falla', async () => {
    const dependencies = setup();
    dependencies.dispatcher.dispatch.mockResolvedValue({
      dispatcher: 'vercel',
      status: 'FAILED',
      error: 'OIDC no disponible',
    });

    await expect(
      dependencies.controller.startJob(USER, { targets: [TARGET] }),
    ).resolves.toEqual({
      jobId: JOB_ID,
      status: 'QUEUED',
      totalItems: 1,
      dispatch: {
        dispatcher: 'vercel',
        status: 'FAILED',
        error: 'OIDC no disponible',
      },
    });
  });
});

function setup() {
  const jobs = {
    start: jest.fn().mockResolvedValue({
      jobId: JOB_ID,
      status: 'QUEUED',
      totalItems: 1,
    }),
  };
  const dispatcher = {
    dispatch: jest.fn().mockResolvedValue({
      dispatcher: 'local',
      status: 'DISPATCHED',
    }),
  };
  return {
    controller: new StockBulkController(
      {} as StockBulkPreviewService,
      jobs as unknown as StockBulkJobService,
      dispatcher as unknown as StockBulkDispatcher,
    ),
    jobs,
    dispatcher,
  };
}
