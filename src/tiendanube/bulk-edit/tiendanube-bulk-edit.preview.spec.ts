import { TiendanubeBulkEditService } from './tiendanube-bulk-edit.service';

describe('TiendanubeBulkEditService preview pagination', () => {
  it('usa x-total-count para recorrer todas las páginas de una categoría grande', async () => {
    const page = (id: number) => [{ id, name: { es: `P${id}` }, visibility: id === 1 ? 'visible' : id === 2 ? 'unlisted' : 'hidden', variants: [{ id: id * 10, visible: id !== 2, price: '10', stock: 1, inventory_levels: [] }] }];
    const api = {
      getWithMeta: jest.fn().mockResolvedValue({ data: page(1), headers: new Headers({ 'x-total-count': '401' }) }),
      get: jest.fn().mockImplementation((_store: string, path: string) => Promise.resolve(page(Number(new URL(`https://x${path}`).searchParams.get('page'))))),
    };
    const repository = { saveSnapshot: jest.fn().mockImplementation(async (input: Record<string, unknown>) => ({ ...input, id: 'snapshot', expires_at: '2030-01-01T00:00:00.000Z' })) };
    const connections = { findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) };
    const service = new TiendanubeBulkEditService(connections as never, api as never, {} as never, repository as never, {} as never);
    const result = await service.preview('user-1', { categoryId: '5', changes: { price: '12' } });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.getWithMeta).toHaveBeenCalledWith('1', expect.stringContaining('visibility=visible,unlisted,hidden'), 'token');
    expect(result.variantCount).toBe(3);
    expect(result.snapshotId).toBe('snapshot');
    expect(result.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    expect(result.products).toHaveLength(3);
    expect('patch' in api).toBe(false);
    expect(repository.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', store_id: '1', variants: expect.any(Array) }));
    expect(repository.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ variants: expect.arrayContaining([expect.objectContaining({ productId: '1', variantId: '10' }), expect.objectContaining({ productId: '2', variantId: '20' }), expect.objectContaining({ productId: '3', variantId: '30' })]) }));
  });

  it('expone un timeout diagnosticable antes de que la plataforma cancele un escaneo largo', async () => {
    const products = Array.from({ length: 200 }, (_, id) => ({ id: id + 1, name: { es: 'P' }, variants: [{ id: id + 10, price: '10', inventory_levels: [] }] }));
    const api = { getWithMeta: jest.fn().mockResolvedValue({ data: products, headers: new Headers({ 'x-total-count': '400' }) }) };
    const service = new TiendanubeBulkEditService({ findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) } as never, api as never, {} as never, {} as never, {} as never);
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(45_000);
    await expect(service.summary('user-1', '5')).rejects.toMatchObject({ status: 504 });
    jest.restoreAllMocks();
  });
});
