import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import { TiendanubeReplicationStatusService } from './tiendanube-replication-status.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const STORE_A = '987654';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type ConnectionRepositoryMock = jest.Mocked<
  Pick<TiendanubeConnectionRepository, 'findSummaryByUserId'>
>;
type ProductLinkRepositoryMock = jest.Mocked<
  Pick<TiendanubeProductLinkRepository, 'findStatusesByMlProductIds'>
>;

describe('TiendanubeReplicationStatusService', () => {
  let connectionRepository: ConnectionRepositoryMock;
  let productLinkRepository: ProductLinkRepositoryMock;
  let service: TiendanubeReplicationStatusService;

  beforeEach(() => {
    connectionRepository = {
      findSummaryByUserId: jest.fn().mockResolvedValue({
        storeId: STORE_A,
        scope: 'write_products',
      }),
    };
    productLinkRepository = {
      findStatusesByMlProductIds: jest.fn().mockResolvedValue([]),
    };
    service = new TiendanubeReplicationStatusService(
      connectionRepository as unknown as TiendanubeConnectionRepository,
      productLinkRepository as unknown as TiendanubeProductLinkRepository,
    );
  });

  it('elimina duplicados, consulta una vez y conserva el orden solicitado', async () => {
    productLinkRepository.findStatusesByMlProductIds.mockResolvedValue([
      {
        mlProductId: PRODUCT_B,
        status: 'FAILED',
        tiendanubeProductId: null,
      },
      {
        mlProductId: PRODUCT_A,
        status: 'COMPLETED',
        tiendanubeProductId: '362983603',
      },
    ]);

    await expect(
      service.getStatus(
        USER_A,
        `${PRODUCT_C}, ${PRODUCT_A.toUpperCase()},${PRODUCT_B},${PRODUCT_A}`,
      ),
    ).resolves.toEqual({
      items: [
        { mlProductId: PRODUCT_C, status: 'NOT_REPLICATED' },
        {
          mlProductId: PRODUCT_A,
          status: 'COMPLETED',
          tiendanubeProductId: '362983603',
        },
        { mlProductId: PRODUCT_B, status: 'FAILED' },
      ],
    });
    expect(connectionRepository.findSummaryByUserId).toHaveBeenCalledTimes(1);
    expect(connectionRepository.findSummaryByUserId).toHaveBeenCalledWith(
      USER_A,
    );
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).toHaveBeenCalledTimes(1);
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).toHaveBeenCalledWith({
      userId: USER_A,
      storeId: STORE_A,
      mlProductIds: [PRODUCT_C, PRODUCT_A, PRODUCT_B],
    });
  });

  it.each([
    ['', 'vacío'],
    ['not-a-uuid', 'UUID inválido'],
    [`${PRODUCT_A},`, 'segmento vacío'],
    [Array.from({ length: 101 }, () => PRODUCT_A).join(','), 'más de 100'],
  ])(
    'rechaza productIds %s (%s) antes de consultar repositorios',
    async (raw) => {
      await expect(service.getStatus(USER_A, raw)).rejects.toMatchObject({
        status: 400,
      });
      expect(connectionRepository.findSummaryByUserId).not.toHaveBeenCalled();
      expect(
        productLinkRepository.findStatusesByMlProductIds,
      ).not.toHaveBeenCalled();
    },
  );

  it('sin conexión Tiendanube responde 401 y no consulta vínculos', async () => {
    connectionRepository.findSummaryByUserId.mockResolvedValue(null);

    await expect(service.getStatus(USER_A, PRODUCT_A)).rejects.toMatchObject({
      status: 401,
    });
    expect(
      productLinkRepository.findStatusesByMlProductIds,
    ).not.toHaveBeenCalled();
  });

  it('rechaza una respuesta duplicada o ajena del repositorio', async () => {
    productLinkRepository.findStatusesByMlProductIds.mockResolvedValue([
      {
        mlProductId: PRODUCT_A,
        status: 'PENDING',
        tiendanubeProductId: null,
      },
      {
        mlProductId: PRODUCT_A,
        status: 'FAILED',
        tiendanubeProductId: null,
      },
    ]);

    await expect(service.getStatus(USER_A, PRODUCT_A)).rejects.toMatchObject({
      status: 503,
    });
  });
});
