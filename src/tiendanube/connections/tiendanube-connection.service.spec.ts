import type { TiendanubeConnectionRepository } from './tiendanube-connection.repository';
import { TiendanubeConnectionService } from './tiendanube-connection.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findSummaryByUserId'>
>;

describe('TiendanubeConnectionService', () => {
  let repository: ConnectionRepositoryMock;
  let service: TiendanubeConnectionService;

  beforeEach(() => {
    repository = {
      findSummaryByUserId: jest.fn(),
    };
    service = new TiendanubeConnectionService(
      repository as TiendanubeConnectionRepository,
    );
  });

  it('devuelve el estado seguro de una conexión existente', async () => {
    repository.findSummaryByUserId.mockResolvedValue({
      storeId: '987654',
      scope: 'write_products',
      accessToken: 'private-access-token',
    } as unknown as Awaited<
      ReturnType<TiendanubeConnectionRepository['findSummaryByUserId']>
    >);

    await expect(service.getStatus(USER_ID)).resolves.toEqual({
      connected: true,
      storeId: '987654',
      scope: 'write_products',
    });
    expect(repository.findSummaryByUserId).toHaveBeenCalledTimes(1);
    expect(repository.findSummaryByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('devuelve connected false cuando no existe conexión', async () => {
    repository.findSummaryByUserId.mockResolvedValue(null);

    await expect(service.getStatus(USER_ID)).resolves.toEqual({
      connected: false,
    });
    expect(repository.findSummaryByUserId).toHaveBeenCalledTimes(1);
    expect(repository.findSummaryByUserId).toHaveBeenCalledWith(USER_ID);
  });
});
