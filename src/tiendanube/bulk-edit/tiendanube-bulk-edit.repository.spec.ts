import { TiendanubeBulkEditRepository } from './tiendanube-bulk-edit.repository';

describe('TiendanubeBulkEditRepository', () => {
  it('conserva el diagnóstico seguro de Supabase cuando no puede guardar un snapshot', async () => {
    const client = { from: jest.fn().mockReturnValue({ insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null, error: { code: '23503', message: 'foreign key violation', details: 'user_id', hint: null } }) }) }) }) };
    const repository = new TiendanubeBulkEditRepository({ getClient: () => client } as never);
    await expect(repository.saveSnapshot({ user_id: 'u', store_id: '1', category_id: '2', changes: { price: '10' }, variants: [] })).rejects.toMatchObject({ response: { operation: 'guardar el snapshot', supabase: { code: '23503', details: 'user_id' } } });
  });
});
