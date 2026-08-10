import { PublicationsController } from './publications.controller';
import { PublicationsService } from './publications.service';
import { PublicationSyncService } from './sync/publication-sync.service';

describe('PublicationsController', () => {
  const list = jest.fn();
  const findOne = jest.fn();
  const syncAll = jest.fn();
  let controller: PublicationsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PublicationsController(
      { list, findOne } as unknown as PublicationsService,
      { syncAll } as unknown as PublicationSyncService,
    );
  });

  it('aplica los valores predeterminados del listado', async () => {
    const response = { publications: [] };
    list.mockResolvedValue(response);

    await expect(controller.list()).resolves.toBe(response);
    expect(list).toHaveBeenCalledWith(1, 20);
  });

  it('delega paginación, detalle y sync', async () => {
    list.mockResolvedValue({});
    findOne.mockResolvedValue({});
    syncAll.mockResolvedValue({ ok: true });

    await controller.list('2', '50');
    await controller.findOne('product-uuid');
    await controller.sync();

    expect(list).toHaveBeenCalledWith(2, 50);
    expect(findOne).toHaveBeenCalledWith('product-uuid');
    expect(syncAll).toHaveBeenCalledTimes(1);
  });
});
