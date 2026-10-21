import { BadRequestException } from '@nestjs/common';

import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import type { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { StockBulkPreviewStockService } from './stock-bulk-preview-stock.service';
import { StockBulkPreviewService } from './stock-bulk-preview.service';
import { StockBulkTargetsService } from './stock-bulk-targets.service';
import {
  parseStockBulkCatalogRequest,
  parseStockBulkSelectionPreviewRequest,
} from './stock-bulk.types';

describe('Stock masivo: catálogo y selección por categoría', () => {
  const token = {
    getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
    getValidAccessToken: jest.fn().mockResolvedValue('token'),
  };
  const scanner = {
    scanActive: jest.fn(async (
      _sellerId: number,
      _token: string,
      consume: (items: readonly unknown[]) => boolean,
    ) => {
      consume([{
        id: 'MLA10',
        title: 'Buzo Mujer frizado',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
        status: 'active',
        price: 45000,
        variations: [
          { id: 1, available_quantity: 0, attribute_combinations: [
            { id: 'SIZE', value_name: '40' },
            { id: 'COLOR', value_name: 'Negro' },
          ] },
          { id: 2, available_quantity: 5, attribute_combinations: [
            { id: 'SIZE', value_name: '44' },
            { id: 'COLOR', value_name: 'Crema' },
          ] },
        ],
      }]);
      consume([{
        id: 'MLA20',
        title: 'Buzo Mujer edición especial',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
        status: 'active',
        price: 60000,
        family_id: 999,
        user_product_id: 'MLAU20',
        available_quantity: 3,
        attributes: [
          { id: 'GENDER', value_name: 'Mujer' },
          { id: 'SIZE', value_name: '42' },
          { id: 'COLOR', value_name: 'Negro' },
        ],
      }, {
        id: 'MLA21',
        title: 'Buzo Mujer oferta alternativa',
        domain_id: 'MLA-SWEATSHIRTS_AND_HOODIES',
        status: 'active',
        price: 52000,
        family_id: 999,
        user_product_id: 'MLAU20',
        available_quantity: 3,
        attributes: [
          { id: 'GENDER', value_name: 'Mujer' },
          { id: 'SIZE', value_name: '42' },
          { id: 'COLOR', value_name: 'Negro' },
        ],
      }]);
      return { reachedEnd: true, nextScrollId: null };
    }),
  };
  const api = {
    getWithMeta: jest.fn().mockResolvedValue({
      data: { locations: [{ type: 'selling_address', quantity: 3 }] },
      headers: new Headers({ 'x-version': '1' }),
    }),
  };
  const service = new StockBulkPreviewService(
    token as unknown as MercadolibreTokenService,
    scanner as unknown as PublicationCatalogScannerService,
    new StockBulkTargetsService(),
    new StockBulkPreviewStockService(api as unknown as MercadolibreApiService),
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recupera todas las variantes activas, antiguas y nuevas, sin filtrar precio ni talle', async () => {
    const result = await service.catalog('user', { productType: 'BUZO_MUJER' });

    expect(scanner.scanActive).toHaveBeenCalledTimes(1);
    expect(result.results.map(({ identifier }) => identifier)).toEqual([
      'MLA10:1', 'MLA10:2', 'MLAU20',
    ]);
    expect(result.results.map(({ color, size }) => [color, size])).toEqual([
      ['Negro', '40'], ['Crema', '44'], ['Negro', '42'],
    ]);
    expect(result.results.map(({ currentQuantity }) => currentQuantity)).toEqual([0, 5, 3]);
    expect(result.results.find(({ identifier }) => identifier === 'MLAU20')?.relatedItemIds)
      .toEqual(['MLA20', 'MLA21']);
    expect(result.results.every(({ needsChange }) => !needsChange)).toBe(true);
    expect(result.summary).toMatchObject({ totalFound: 3, legacy: 2, userProduct: 1 });
  });

  it('solo previsualiza los identificadores filtrados y no aplica cambios', async () => {
    const result = await service.selectionPreview('user', {
      productType: 'BUZO_MUJER',
      identifiers: ['MLA10:1', 'MLAU20'],
      quantity: 10,
    });
    expect(result.results.map(({ identifier, requestedQuantity }) => [
      identifier, requestedQuantity,
    ])).toEqual([['MLA10:1', 10], ['MLAU20', 10]]);
    expect(result.summary.totalFound).toBe(2);
    expect(api.getWithMeta).toHaveBeenCalled();
  });

  it('rechaza IDs ausentes o desactualizados, sin aplicarlos a otros productos', async () => {
    await expect(service.selectionPreview('user', {
      productType: 'BUZO_MUJER',
      identifiers: ['MLA999'],
      quantity: 4,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida cantidad cero, identificadores únicos y producto', () => {
    expect(parseStockBulkCatalogRequest({ productType: 'BUZO_MUJER' }))
      .toEqual({ productType: 'BUZO_MUJER' });
    expect(parseStockBulkSelectionPreviewRequest({
      productType: 'BUZO_MUJER', identifiers: ['MLA10:1'], quantity: 0,
    })).toMatchObject({ quantity: 0 });
    expect(() => parseStockBulkSelectionPreviewRequest({
      productType: 'BUZO_MUJER', identifiers: ['MLA10:1', 'MLA10:1'], quantity: 5,
    })).toThrow(BadRequestException);
    expect(() => parseStockBulkSelectionPreviewRequest({
      productType: 'BUZO_MUJER', identifiers: ['MLA10:1'], quantity: -1,
    })).toThrow(BadRequestException);
  });
});
