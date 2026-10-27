import { BadRequestException, ConflictException } from '@nestjs/common';
import { TiendanubeSizeStockService } from './tiendanube-size-stock.service';

const baseProduct = {
  id: 1001,
  visibility: 'visible',
  published: true,
  attributes: [{ es: 'Color' }, { es: 'Talle' }],
  variants: [
    {
      id: 5001,
      visible: true,
      values: [{ es: 'Negro' }, { es: 'S' }],
      stock: 0,
      inventory_levels: [],
      price: '45000',
      sku: 'SKU-S',
    },
  ],
};
const update = {
  productId: '1001',
  variantId: '5001',
  size: 'S',
  expectedStock: 0,
  stock: 5,
};

function setup(source: Record<string, unknown> = baseProduct) {
  let reads = 0;
  const api = {
    get: jest.fn().mockImplementation(async () => {
      reads++;
      return reads === 1
        ? source
        : { ...source, variants: [{ ...baseProduct.variants[0], stock: 5 }] };
    }),
    patch: jest.fn().mockResolvedValue([{ id: 1001, variants: [{ id: 5001, success: true }] }]),
  };
  const connections = {
    findOwnedCredentialsByUserId: jest.fn().mockResolvedValue({
      storeId: '999', accessToken: 'PRIVATE_TOKEN', userId: 'user-1',
    }),
  };
  return {
    service: new TiendanubeSizeStockService(connections as never, api as never),
    api,
    connections,
  };
}

describe('TiendanubeSizeStockService', () => {
  it('actualiza solo stock de la variante visible y verifica el resultado', async () => {
    const { service, api } = setup();
    await expect(service.applyBatch('user-1', { updates: [update] }))
      .resolves.toEqual({ updatedVariantIds: ['5001'], failedVariantIds: [] });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith(
      '999', '/products/stock-price',
      [{ id: 1001, variants: [{ id: 5001, inventory_levels: [{ stock: 5 }] }] }],
      'PRIVATE_TOKEN',
    );
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(api.patch.mock.calls[0]?.[2])).not.toMatch(/price|sku|color|values/u);
  });

  it('rechaza producto oculto sin modificar nada', async () => {
    const { service, api } = setup({ ...baseProduct, visibility: 'hidden', published: false });
    await expect(service.applyBatch('user-1', { updates: [update] }))
      .rejects.toThrow(ConflictException);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('rechaza variante oculta, talle modificado, o stock desactualizado', async () => {
    for (const product of [
      { ...baseProduct, variants: [{ ...baseProduct.variants[0], visible: false }] },
      { ...baseProduct, variants: [{ ...baseProduct.variants[0], values: [{ es: 'Negro' }, { es: 'M' }] }] },
      { ...baseProduct, variants: [{ ...baseProduct.variants[0], stock: 3 }] },
    ]) {
      const { service, api } = setup(product);
      await expect(service.applyBatch('user-1', { updates: [update] }))
        .rejects.toThrow(ConflictException);
      expect(api.patch).not.toHaveBeenCalled();
    }
  });

  it('rechaza múltiples depósitos sin location id', async () => {
    const { service, api } = setup({
      ...baseProduct,
      variants: [{
        ...baseProduct.variants[0],
        inventory_levels: [{ location_id: '1', stock: 0 }, { location_id: '2', stock: 0 }],
      }],
    });
    await expect(service.applyBatch('user-1', { updates: [update] }))
      .rejects.toThrow(ConflictException);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('rechaza duplicados, stock inválido y lotes excesivos', async () => {
    const { service, api } = setup();
    await expect(service.applyBatch('user-1', { updates: [update, update] }))
      .rejects.toThrow(BadRequestException);
    await expect(service.applyBatch('user-1', { updates: [{ ...update, stock: -1 }] }))
      .rejects.toThrow(BadRequestException);
    await expect(service.applyBatch('user-1', { updates: Array.from({ length: 21 }, () => update) }))
      .rejects.toThrow(BadRequestException);
    expect(api.patch).not.toHaveBeenCalled();
  });
});
