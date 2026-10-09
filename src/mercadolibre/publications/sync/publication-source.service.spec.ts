import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  it('obtiene el total sin recorrer el catÃ¡logo', async () => {
    const { api, source } = createSource(() => ({
      results: ['MLA1'],
      paging: { total: 321 },
    }));

    await expect(source.getItemsTotal(123, 'private-token')).resolves.toBe(
      321,
    );

    expect(api.calls).toHaveLength(1);
    const query = parsePath(api.calls[0].path).searchParams;
    expect(query.get('search_type')).toBe('scan');
    expect(query.get('limit')).toBe('1');
  });

  it('obtiene la primera página del scan sin scroll_id', async () => {
    const { api, source } = createSource(() => ({
      results: ['MLA1', 'MLA1', 'MLA2'],
      scroll_id: 'first-scroll',
    }));

    await expect(
      source.fetchNextScanPage(123, 'private-token'),
    ).resolves.toEqual({
      itemIds: ['MLA1', 'MLA2'],
      scrollId: 'first-scroll',
    });

    const call = api.calls[0];
    const url = parsePath(call.path);
    expect(url.searchParams.get('search_type')).toBe('scan');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.has('scroll_id')).toBe(false);
    expect(call.kind).toBeUndefined();
  });

  it('continúa el scan con el scroll_id recibido', async () => {
    const { api, source } = createSource(() => ({
      results: ['MLA3'],
      scroll_id: 'next-scroll',
    }));

    await expect(
      source.fetchNextScanPage(123, 'private-token', 'current-scroll'),
    ).resolves.toEqual({ itemIds: ['MLA3'], scrollId: 'next-scroll' });

    const call = api.calls[0];
    expect(parsePath(call.path).searchParams.get('scroll_id')).toBe(
      'current-scroll',
    );
    expect(call.kind).toBe('scroll');
  });

  it('devuelve un estado terminal cuando ya no hay resultados', async () => {
    const { source } = createSource(() => ({ results: null }));

    await expect(
      source.fetchNextScanPage(123, 'private-token', 'current-scroll'),
    ).resolves.toEqual({ itemIds: [], scrollId: null });
  });

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

  it('usa bulk de veinte, atributos body y errores individuales saneados', async () => {
    const { api, source } = createSource(() => [
      {
        id: 'MLA1',
        status_code: 200,
        body: { id: 'MLA1', title: 'Producto', access_token: 'secret' },
      },
      {
        id: 'MLA2',
        status_code: 403,
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
    expect(parsePath(api.calls[0].path).pathname).toBe('/items/bulk');
    expect(query.get('ids')).toBe('MLA1,MLA2');
    expect(query.get('attributes')).toBe(
      PUBLICATION_SYNC_ATTRIBUTES.map(
        (attribute) => `body.${attribute}`,
      ).join(','),
    );
    expect(api.calls[0].accessToken).toBe('private-token');
  });

  it('compara un bulk controlado con el detalle del mismo ítem', async () => {
    const publication = {
      id: 'MLA1',
      seller_id: 123,
      title: 'Producto',
    };
    const { api, source } = createSource(({ path }) =>
      path.startsWith('/items/bulk')
        ? [{ id: 'MLA1', status_code: 200, body: publication }]
        : publication,
    );

    const bulk = await source.fetchItemBatch(['MLA1'], 'private-token');
    const detail = await source.getItem('MLA1', 'private-token');

    expect(bulk.publications).toEqual([detail]);
    expect(bulk.publications[0]).toMatchObject({
      id: 'MLA1',
      seller_id: 123,
    });
    const attributes = parsePath(api.calls[0].path).searchParams.get(
      'attributes',
    );
    expect(attributes).toContain('body.id');
    expect(attributes).toContain('body.seller_id');
    expect(api.calls[1].path).toBe('/items/MLA1');
  });

  it('recupera por detalle individual una respuesta bulk sin status_code', async () => {
    const publication = { id: 'MLA1', seller_id: 123, title: 'Producto' };
    const { api, source } = createSource(({ path }) =>
      path.startsWith('/items/bulk')
        ? [{ id: 'MLA1', body: { id: 'MLA1' } }]
        : publication,
    );

    await expect(
      source.fetchItemBatch(['MLA1'], 'private-token', 123),
    ).resolves.toEqual({ publications: [publication], errors: [] });

    expect(api.calls.map((call) => call.path)).toEqual([
      expect.stringContaining('/items/bulk?'),
      '/items/MLA1',
    ]);
    expect(api.calls[1].kind).toBe('itemLookup');
  });

  it('recupera por detalle individual una entrada bulk sin id raíz', async () => {
    const publication = { id: 'MLA1', seller_id: 123, title: 'Producto' };
    const { api, source } = createSource(({ path }) =>
      path.startsWith('/items/bulk')
        ? [{ status_code: 200, body: publication }]
        : publication,
    );

    await expect(
      source.fetchItemBatch(['MLA1'], 'private-token', 123),
    ).resolves.toEqual({ publications: [publication], errors: [] });

    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].path).toBe('/items/MLA1');
  });

  it('recupera solo los IDs faltantes de la respuesta bulk', async () => {
    const { api, source } = createSource(({ path }) => {
      if (path.startsWith('/items/bulk')) {
        return [
          {
            id: 'MLA1',
            status_code: 200,
            body: { id: 'MLA1', seller_id: 123 },
          },
        ];
      }
      return { id: 'MLA2', seller_id: 123 };
    });

    await expect(
      source.fetchItemBatch(['MLA1', 'MLA2'], 'private-token', 123),
    ).resolves.toEqual({
      publications: [
        { id: 'MLA1', seller_id: 123 },
        { id: 'MLA2', seller_id: 123 },
      ],
      errors: [],
    });

    expect(api.calls.map((call) => parsePath(call.path).pathname)).toEqual([
      '/items/bulk',
      '/items/MLA2',
    ]);
  });

  it('conserva los errores HTTP reales informados por bulk', async () => {
    const { api, source } = createSource(() => [
      {
        id: 'MLA1',
        status_code: 429,
        body: { message: 'rate limited' },
      },
    ]);

    await expect(
      source.fetchItemBatch(['MLA1'], 'private-token'),
    ).resolves.toEqual({
      publications: [],
      errors: [{ itemId: 'MLA1', status: 429, body: { message: 'rate limited' } }],
    });
    expect(api.calls).toHaveLength(1);
  });

  it('propaga un error HTTP real del fallback individual', async () => {
    const { source } = createSource(({ path }) => {
      if (path.startsWith('/items/bulk')) return { invalid: true };
      throw new ServiceUnavailableException('rate limited');
    });

    await expect(
      source.fetchItemBatch(['MLA1'], 'private-token', 123),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('conserva compatibilidad con el formato anterior del multiget', async () => {
    const { source } = createSource(() => [
      { code: 200, body: { id: 'MLA1', title: 'Producto' } },
      { code: 404, body: { message: 'Not found' } },
    ]);

    await expect(
      source.fetchItemBatch(['MLA1', 'MLA2'], 'private-token'),
    ).resolves.toEqual({
      publications: [{ id: 'MLA1', title: 'Producto' }],
      errors: [{ itemId: 'MLA2', status: 404, body: { message: 'Not found' } }],
    });
  });

  it('ejecuta una sola solicitud multiget a la vez', async () => {
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
    expect(maximum).toBe(1);
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

  it('puede solicitar todos los atributos sin omitir el saneamiento', async () => {
    const { api, source } = createSource(() => ({
      id: 'MLA123',
      attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-123' }],
      access_token: 'secret',
    }));

    await expect(
      source.getItemWithAllAttributes('MLA123', 'private-token'),
    ).resolves.toEqual({
      id: 'MLA123',
      attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-123' }],
    });
    expect(api.calls).toEqual([
      {
        path: '/items/MLA123?include_attributes=all',
        accessToken: 'private-token',
        kind: 'itemLookup',
      },
    ]);
  });

  it('rechaza respuestas externas mal formadas', async () => {
    const { source } = createSource(() => ({ results: ['MLA1'] }));
    await expect(
      source.getAllItemIds(123, 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
