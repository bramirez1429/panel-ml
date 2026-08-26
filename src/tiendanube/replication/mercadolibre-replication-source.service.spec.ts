import { ForbiddenException } from '@nestjs/common';

import type { MercadolibreProductDetail } from '../../database/repositories/mercadolibre-publications.types';
import type { MercadoLibreReplicationNormalizerService } from './mercadolibre-replication-normalizer.service';
import { MercadoLibreReplicationSourceService } from './mercadolibre-replication-source.service';

const PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  seller_id: 42,
  external_key: 'family:123',
} as MercadolibreProductDetail;

describe('MercadoLibreReplicationSourceService', () => {
  it('usa el registro persistido sólo como identidad y normaliza desde Mercado Libre', async () => {
    const normalized = {
      title: 'Producto vivo',
      description: null,
      images: [],
      attributes: [],
      variants: [{ price: 100, stock: 2, sku: null, values: [] }],
    };
    const normalizer = {
      normalize: jest.fn().mockResolvedValue(normalized),
    };
    const service = new MercadoLibreReplicationSourceService(
      normalizer as unknown as MercadoLibreReplicationNormalizerService,
    );

    await expect(service.load(PRODUCT, 42, 'ml-token')).resolves.toBe(
      normalized,
    );
    expect(normalizer.normalize).toHaveBeenCalledWith(
      'family:123',
      42,
      'ml-token',
    );
  });

  it('rechaza un registro que no pertenece al seller conectado', async () => {
    const normalizer = { normalize: jest.fn() };
    const service = new MercadoLibreReplicationSourceService(
      normalizer as unknown as MercadoLibreReplicationNormalizerService,
    );

    await expect(service.load(PRODUCT, 99, 'ml-token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(normalizer.normalize).not.toHaveBeenCalled();
  });
});
