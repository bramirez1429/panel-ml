import { TiendanubeBulkEditService } from './tiendanube-bulk-edit.service';

describe('TiendanubeBulkEditService worker', () => {
  const item = { id: 'item-1', job_id: 'job-1', product_id: '10', product_name: 'Producto', variant_id: '20', sku: 'SKU', requested_changes: {}, status: 'PROCESSING', attempts: 1, error_code: null, error_message: null, updated_at: '' };
  const job = { id: 'job-1', user_id: 'user-1', store_id: '1', category_id: '2', status: 'QUEUED', total_products: 1, total_variants: 1, completed_variants: 0, failed_variants: 0, started_at: null, finished_at: null, execution_token: 'token', lease_expires_at: null, error_message: null, created_at: '', updated_at: '', requested_changes: { price: '100.50', promotionalPrice: '90', stock: 3, locationId: 'loc' } };
  it('envía sólo los campos completados y confirma success por variante', async () => {
    const repository = { findJob: jest.fn().mockResolvedValue(job), claimJob: jest.fn().mockResolvedValue(true), claimItems: jest.fn().mockResolvedValue([item]), finishItems: jest.fn(), refresh: jest.fn().mockResolvedValue({ ...job, status: 'COMPLETED' }) };
    const api = { patch: jest.fn().mockResolvedValue([{ id: 10, variants: [{ id: 20, success: true }] }]) };
    const connections = { findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) };
    const service = new TiendanubeBulkEditService(connections as never, api as never, {} as never, repository as never, {} as never);
    await expect(service.processNext('job-1', 'token')).resolves.toEqual({ hasMore: false });
    expect(api.patch).toHaveBeenCalledWith('1', '/products/stock-price', [{ id: 10, variants: [{ id: 20, price: 100.5, promotional_price: 90, inventory_levels: [{ stock: 3, location_id: 'loc' }] }] }], 'token');
    expect(repository.finishItems).toHaveBeenCalledWith('job-1', 'token', ['item-1'], []);
  });

  it('no reintenta como éxito una respuesta incierta que no se puede verificar', async () => {
    const repository = { findJob: jest.fn().mockResolvedValue(job), claimJob: jest.fn().mockResolvedValue(true), claimItems: jest.fn().mockResolvedValue([item]), finishItems: jest.fn(), refresh: jest.fn().mockResolvedValue({ ...job, status: 'COMPLETED_WITH_ERRORS' }) };
    const api = { patch: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue({ variants: [] }) };
    const connections = { findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) };
    const service = new TiendanubeBulkEditService(connections as never, api as never, {} as never, repository as never, {} as never);
    await service.processNext('job-1', 'token');
    expect(repository.finishItems).toHaveBeenCalledWith('job-1', 'token', [], [expect.objectContaining({ id: 'item-1', code: 'TIENDANUBE_UNCERTAIN_RESULT' })]);
  });

  it('entrega el contrato de failures usando option_values', async () => {
    const failedItem = { ...item, option_values: ['Azul', 'M'], error_message: 'Precio promocional inválido' };
    const repository = { findJob: jest.fn().mockResolvedValue(job), failures: jest.fn().mockResolvedValue([failedItem]) };
    const connections = { findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) };
    const service = new TiendanubeBulkEditService(connections as never, {} as never, {} as never, repository as never, {} as never);
    await expect(service.failures('user-1', 'job-1')).resolves.toEqual([{ productName: 'Producto', productId: '10', variantId: '20', sku: 'SKU', variant: 'Azul / M', error: 'Precio promocional inválido' }]);
  });

  it('confirma el mismo UUID del snapshot que recibió el endpoint', async () => {
    const snapshot = { id: 'd8099c2c-4c30-4c71-9681-7a9bc6cd778c', user_id: 'user-1', store_id: '1', category_id: '2', expires_at: '2030-01-01T00:00:00.000Z', changes: { price: '100' }, variants: [] };
    const createdJob = { id: 'job-1', status: 'QUEUED', execution_token: 'token' };
    const repository = { getSnapshot: jest.fn().mockResolvedValue(snapshot), createJob: jest.fn().mockResolvedValue(createdJob) };
    const queue = { enqueue: jest.fn() };
    const connections = { findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({ storeId: '1', accessToken: 'token' }) };
    const service = new TiendanubeBulkEditService(connections as never, {} as never, {} as never, repository as never, queue as never);
    await expect(service.createJob('user-1', snapshot.id)).resolves.toEqual({ id: 'job-1', status: 'QUEUED' });
    expect(repository.getSnapshot).toHaveBeenCalledWith(snapshot.id, 'user-1', '1');
    expect(repository.createJob).toHaveBeenCalledWith(snapshot);
  });
});
