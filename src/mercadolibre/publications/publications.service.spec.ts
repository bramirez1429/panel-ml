import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MercadoLibreConnection } from '../../database/supabase.service';
import { MercadolibreTokenService } from '../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../shared/mercadolibre-api.service';
import { MercadoLibreRequestKind } from '../shared/mercadolibre.types';
import { PublicationGroupsService } from './publication-groups.service';
import { PublicationDetails, PublicationRow } from './publication.types';
import { PublicationsService } from './publications.service';

type ApiGet = (
  path: string,
  accessToken?: string,
  kind?: MercadoLibreRequestKind,
) => Promise<unknown>;

const connection: MercadoLibreConnection = {
  seller_id: 123456,
  nickname: 'TEST_SELLER',
  access_token: 'stored-token',
  refresh_token: 'stored-refresh-token',
  expires_at: '2030-01-01T00:00:00.000Z',
  updated_at: '2029-12-31T00:00:00.000Z',
};

/** Crea una fila compartida para las pruebas de paginación. */
function sharedRow(id: string): PublicationRow {
  return {
    type: 'SHARED',
    parent: {
      id,
      title: `Producto ${id}`,
      status: 'active',
      thumbnail: null,
      price: 10_000,
    },
    children: [],
  };
}

describe('PublicationsService', () => {
  let service: PublicationsService;
  let apiGet: jest.MockedFunction<ApiGet>;
  let getStoredConnection: jest.MockedFunction<
    MercadolibreTokenService['getStoredConnection']
  >;
  let getValidAccessToken: jest.MockedFunction<
    MercadolibreTokenService['getValidAccessToken']
  >;
  let buildPublicationRows: jest.MockedFunction<
    PublicationGroupsService['buildPublicationRows']
  >;

  beforeEach(() => {
    apiGet = jest.fn();
    getStoredConnection = jest.fn();
    getValidAccessToken = jest.fn();
    buildPublicationRows = jest.fn();

    service = new PublicationsService(
      {
        getStoredConnection,
        getValidAccessToken,
      } as unknown as MercadolibreTokenService,
      { get: apiGet } as unknown as MercadolibreApiService,
      { buildPublicationRows } as unknown as PublicationGroupsService,
    );
  });

  it('recorre el scan, conserva el primer scroll_id y elimina duplicados', async () => {
    apiGet
      .mockResolvedValueOnce({
        results: ['MLA1', 'MLA2'],
        scroll_id: 'first-scroll',
      })
      .mockResolvedValueOnce({
        results: ['MLA2', 'MLA3'],
        scroll_id: 'changed-scroll',
      })
      .mockResolvedValueOnce({ results: [] });

    await expect(
      service.getAllPublicationIds(connection.seller_id, 'private-token'),
    ).resolves.toEqual(['MLA1', 'MLA2', 'MLA3']);

    const requests = apiGet.mock.calls.map(
      ([path]) => new URL(path, 'https://api.mercadolibre.com'),
    );
    expect(requests[0].searchParams.get('search_type')).toBe('scan');
    expect(requests[0].searchParams.get('limit')).toBe('100');
    expect(requests[0].searchParams.has('scroll_id')).toBe(false);
    expect(requests[1].searchParams.get('scroll_id')).toBe('first-scroll');
    expect(requests[2].searchParams.get('scroll_id')).toBe('first-scroll');
    expect(apiGet.mock.calls[0][2]).toBeUndefined();
    expect(apiGet.mock.calls[1][2]).toBe('scroll');
  });

  it('acepta un scan vacío y exige scroll_id cuando hay resultados', async () => {
    apiGet.mockResolvedValueOnce({ results: null });
    await expect(
      service.getAllPublicationIds(connection.seller_id, 'private-token'),
    ).resolves.toEqual([]);

    apiGet.mockResolvedValueOnce({ results: ['MLA1'] });
    await expect(
      service.getAllPublicationIds(connection.seller_id, 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('procesa multiget de veinte IDs con hasta cuatro solicitudes simultáneas', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `MLA${index + 1}`);
    let activeRequests = 0;
    let maximumConcurrency = 0;

    apiGet.mockImplementation(async (path) => {
      activeRequests += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;

      const batchIds =
        new URL(path, 'https://api.mercadolibre.com').searchParams
          .get('ids')
          ?.split(',') ?? [];
      return batchIds.map((id) => ({ code: 200, body: { id } }));
    });

    const result = await service.getPublicationDetails(ids, 'private-token');

    expect(result.publications).toHaveLength(100);
    expect(result.errors).toEqual([]);
    expect(apiGet).toHaveBeenCalledTimes(5);
    expect(maximumConcurrency).toBe(4);
    for (const [path] of apiGet.mock.calls) {
      const batchIds = new URL(
        path,
        'https://api.mercadolibre.com',
      ).searchParams
        .get('ids')
        ?.split(',');
      expect(batchIds?.length).toBeLessThanOrEqual(20);
    }
  });

  it('conserva resultados exitosos y sanea errores parciales', async () => {
    apiGet.mockResolvedValueOnce([
      {
        code: 200,
        body: { id: 'MLA1', title: 'Producto', access_token: 'secret' },
      },
      {
        code: 403,
        body: { message: 'Forbidden', refresh_token: 'secret' },
      },
    ]);

    const result = await service.fetchItemBatch(
      ['MLA1', 'MLA2'],
      'private-token',
    );

    expect(result.publications).toEqual([{ id: 'MLA1', title: 'Producto' }]);
    expect(result.errors).toEqual([
      { id: 'MLA2', code: 403, body: { message: 'Forbidden' } },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('convierte un error HTTP del multiget en errores por cada MLA', async () => {
    apiGet.mockRejectedValueOnce(
      new ForbiddenException({
        message: 'Permisos insuficientes',
        Authorization: 'Bearer secret',
      }),
    );

    await expect(
      service.fetchItemBatch(['MLA1', 'MLA2'], 'private-token'),
    ).resolves.toEqual({
      publications: [],
      errors: [
        {
          id: 'MLA1',
          code: 403,
          body: { message: 'Permisos insuficientes' },
        },
        {
          id: 'MLA2',
          code: 403,
          body: { message: 'Permisos insuficientes' },
        },
      ],
    });
  });

  it('agrupa antes de paginar y conserva los errores de detalles', async () => {
    const ids = ['MLA1', 'MLA2', 'MLA3', 'MLA4'];
    const details: PublicationDetails = {
      publications: ids.slice(0, 3).map((id) => ({ id })),
      errors: [{ id: 'MLA4', code: 404, body: 'Not found' }],
    };
    const rows = [sharedRow('MLA1'), sharedRow('MLA2'), sharedRow('MLA3')];
    getStoredConnection.mockResolvedValue(connection);
    getValidAccessToken.mockResolvedValue('private-token');
    jest.spyOn(service, 'getAllPublicationIds').mockResolvedValue(ids);
    jest.spyOn(service, 'getPublicationDetails').mockResolvedValue(details);
    buildPublicationRows.mockResolvedValue(rows);

    await expect(service.getPublicationsPage(2, 2)).resolves.toEqual({
      paging: { page: 2, limit: 2, total: 3, totalPages: 2 },
      totalItems: 4,
      count: 1,
      publications: [rows[2]],
      errors: details.errors,
    });
    expect(getValidAccessToken).toHaveBeenCalledWith(connection);
    expect(buildPublicationRows).toHaveBeenCalledWith(
      details.publications,
      'private-token',
    );
  });

  it('valida la paginación antes de consultar la conexión', async () => {
    await expect(service.getPublicationsPage(0, 20)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getPublicationsPage(1, 101)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(getStoredConnection).not.toHaveBeenCalled();
  });

  it('obtiene una publicación sin exponer credenciales externas', async () => {
    getValidAccessToken.mockResolvedValue('private-token');
    apiGet.mockResolvedValueOnce({
      id: 'MLA123',
      title: 'Producto',
      access_token: 'must-not-leak',
    });

    await expect(service.getPublication('MLA123')).resolves.toEqual({
      id: 'MLA123',
      title: 'Producto',
    });
    expect(apiGet).toHaveBeenCalledWith('/items/MLA123', 'private-token');
  });

  it('rechaza un itemId inválido y una respuesta con otro ID', async () => {
    await expect(service.getPublication('MLAU123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(getValidAccessToken).not.toHaveBeenCalled();

    getValidAccessToken.mockResolvedValue('private-token');
    apiGet.mockResolvedValueOnce({ id: 'MLA999' });
    await expect(service.getPublication('MLA123')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
