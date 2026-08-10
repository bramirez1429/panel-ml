import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { MercadoLibreRequestKind } from '../../shared/mercadolibre.types';
import { PUBLICATION_SYNC_ATTRIBUTES } from '../publication.constants';
import { PublicationSourceService } from './publication-source.service';

type ApiCall = {
  path: string;
  accessToken?: string;
  kind?: MercadoLibreRequestKind;
};
type ResponseFactory = (call: ApiCall) => unknown;

class ApiStub {
  readonly calls: ApiCall[] = [];

  constructor(private readonly responseFactory: ResponseFactory) {}

  /** Simula una consulta a Mercado Libre. */
  async get<T>(
    path: string,
    accessToken?: string,
    kind?: MercadoLibreRequestKind,
  ): Promise<T> {
    const call = { path, accessToken, kind };
    this.calls.push(call);
    return (await this.responseFactory(call)) as T;
  }
}

/** Crea el origen con un API controlado. */
function createSource(responseFactory: ResponseFactory) {
  const api = new ApiStub(responseFactory);
  const source = new PublicationSourceService(
    api as unknown as MercadolibreApiService,
  );
  return { api, source };
}

/** Lee una ruta relativa como URL de Mercado Libre. */
function parsePath(path: string): URL {
  return new URL(path, 'https://api.mercadolibre.com');
}

describe('PublicationSourceService', () => {
  it('recorre scan con el primer scroll_id y elimina IDs duplicados', async () => {
    const responses = [
      { results: ['MLA1', 'MLA2'], scroll_id: 'first-scroll' },
      { results: ['MLA2', 'MLA3'], scroll_id: 'changed-scroll' },
      { results: null },
    ];
    const { api, source } = createSource(() => responses.shift());

    await expect(source.getAllItemIds(123, 'private-token')).resolves.toEqual([
      'MLA1',
      'MLA2',
      'MLA3',
    ]);

    expect(api.calls).toHaveLength(3);
    const urls = api.calls.map((call) => parsePath(call.path));
    expect(urls[0].searchParams.get('search_type')).toBe('scan');
    expect(urls[0].searchParams.get('limit')).toBe('100');
    expect(urls[0].searchParams.has('scroll_id')).toBe(false);
    expect(urls[1].searchParams.get('scroll_id')).toBe('first-scroll');
    expect(urls[2].searchParams.get('scroll_id')).toBe('first-scroll');
    expect(api.calls.map((call) => call.kind)).toEqual([
      undefined,
      'scroll',
      'scroll',
    ]);
  });

  it('usa multiget de veinte, atributos fijos y errores saneados', async () => {
    const { api, source } = createSource(() => [
      {
        code: 200,
        body: { id: 'MLA1', title: 'Producto', access_token: 'secret' },
      },
      {
        code: 403,
        body: { message: 'Forbidden', refresh_token: 'secret' },
      },
    ]);

    await expect(
      source.fetchItemBatch(['MLA1', 'MLA2'], 'private-token'),
    ).resolves.toEqual({
      publications: [{ id: 'MLA1', title: 'Producto' }],
      errors: [{ itemId: 'MLA2', status: 403, body: { message: 'Forbidden' } }],
    });

    const query = parsePath(api.calls[0].path).searchParams;
    expect(query.get('ids')).toBe('MLA1,MLA2');
    expect(query.get('attributes')).toBe(PUBLICATION_SYNC_ATTRIBUTES.join(','));
    expect(api.calls[0].accessToken).toBe('private-token');
  });

  it('limita los multiget a cuatro solicitudes simultáneas', async () => {
    let active = 0;
    let maximum = 0;
    const { source } = createSource(async ({ path }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      const ids = parsePath(path).searchParams.get('ids')?.split(',') ?? [];
      return ids.map((id) => ({ code: 200, body: { id } }));
    });
    const ids = Array.from({ length: 100 }, (_, index) => `MLA${index + 1}`);

    const result = await source.getPublicationDetails(ids, 'private-token');

    expect(result.publications).toHaveLength(100);
    expect(result.errors).toEqual([]);
    expect(maximum).toBe(4);
  });

  it('pagina la búsqueda por varios User Products y deduplica MLA', async () => {
    const responses = [
      { results: ['MLA1', 'MLA2'], paging: { total: 3 } },
      { results: ['MLA2'], paging: { total: 3 } },
    ];
    const { api, source } = createSource(() => responses.shift());

    await expect(
      source.getItemIdsForUserProducts(
        123,
        ['MLAU1', 'MLAU2', 'MLAU1'],
        'private-token',
      ),
    ).resolves.toEqual(['MLA1', 'MLA2']);

    const urls = api.calls.map((call) => parsePath(call.path));
    expect(urls[0].searchParams.get('user_product_id')).toBe('MLAU1,MLAU2');
    expect(urls[0].searchParams.get('limit')).toBe('50');
    expect(urls[0].searchParams.get('offset')).toBe('0');
    expect(urls[1].searchParams.get('offset')).toBe('2');
  });

  it('divide familias grandes en filtros de hasta veinte MLAU', async () => {
    const { api, source } = createSource(({ path }) => {
      const values =
        parsePath(path).searchParams.get('user_product_id')?.split(',') ?? [];
      return {
        results: values.map((id) => id.replace('MLAU', 'MLA')),
        paging: { total: values.length },
      };
    });
    const userProductIds = Array.from(
      { length: 45 },
      (_, index) => `MLAU${index + 1}`,
    );

    const result = await source.getItemIdsForUserProducts(
      123,
      userProductIds,
      'private-token',
    );

    expect(result).toHaveLength(45);
    expect(api.calls).toHaveLength(3);
    expect(
      api.calls.map(
        ({ path }) =>
          parsePath(path).searchParams.get('user_product_id')?.split(',')
            .length,
      ),
    ).toEqual([20, 20, 5]);
  });

  it('obtiene un ítem seguro y valida su identificador', async () => {
    const { source } = createSource(() => ({
      id: 'MLA123',
      title: 'Producto',
      authorization: 'secret',
    }));

    await expect(source.getItem('MLA123', 'private-token')).resolves.toEqual({
      id: 'MLA123',
      title: 'Producto',
    });
    await expect(
      source.getItem('MLAU123', 'private-token'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza respuestas externas mal formadas', async () => {
    const { source } = createSource(() => ({ results: ['MLA1'] }));
    await expect(
      source.getAllItemIds(123, 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
