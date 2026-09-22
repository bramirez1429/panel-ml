import type { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import type { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import type { StockService } from '../stock/stock.service';
import { StockBulkPreviewService } from './stock-bulk-preview.service';
import { StockBulkTargetsService } from './stock-bulk-targets.service';

describe('StockBulkPreviewService', () => {
  it('recorre todo el cat\u00e1logo y resume variantes USER_PRODUCT y LEGACY', async () => {
    const token = {
      getStoredConnection: jest.fn().mockResolvedValue({ seller_id: 42 }),
      getValidAccessToken: jest.fn().mockResolvedValue('access-token'),
    };
    const stock = {
      getNewStock: jest.fn().mockResolvedValue({
        locations: [{ type: 'selling_address', quantity: 4 }],
      }),
      updateNew: jest.fn(),
      updateClassic: jest.fn(),
    };
    const scanner = {
      scan: jest.fn(
        (
          _sellerId: number,
          _accessToken: string,
          _cursor: string | undefined,
          consume: (items: readonly unknown[]) => boolean,
        ) => {
          consume([
            {
              id: 'MLA1',
              title: 'Buzo Mujer Negro',
              family_id: 100,
              user_product_id: 'MLAU1',
              status: 'active',
              available_quantity: 99,
              attributes: [
                { id: 'SIZE', value_name: '40' },
                { id: 'COLOR', value_name: 'Negro' },
              ],
            },
          ]);
          consume([
            {
              id: 'MLA2',
              title: 'Buzo Mujer Rosa',
              status: 'paused',
              variations: [
                {
                  id: 200,
                  available_quantity: 0,
                  attribute_combinations: [
                    { id: 'SIZE', value_name: '42' },
                    { id: 'COLOR', value_name: 'Rosa' },
                  ],
                },
              ],
            },
          ]);
          return Promise.resolve({ reachedEnd: true, nextScrollId: null });
        },
      ),
    };
    const targets = new StockBulkTargetsService(
      stock as unknown as StockService,
    );
    const service = new StockBulkPreviewService(
      token as unknown as MercadolibreTokenService,
      scanner as unknown as PublicationCatalogScannerService,
      targets,
    );

    const result = await service.preview('user-1', {
      productType: 'BUZO_MUJER',
      sizes: [
        { size: '40', quantity: 4 },
        { size: '42', quantity: 2 },
      ],
    });

    expect(result.results).toEqual([
      expect.objectContaining({
        identifier: 'MLAU1',
        itemId: 'MLA1',
        userProductId: 'MLAU1',
        familyId: '100',
        model: 'USER_PRODUCT',
        currentQuantity: 4,
        requestedQuantity: 4,
        needsChange: false,
        editable: true,
      }),
      expect.objectContaining({
        identifier: 'MLA2:200',
        itemId: 'MLA2',
        variationId: '200',
        model: 'LEGACY',
        currentQuantity: 0,
        requestedQuantity: 2,
        currentStatus: 'paused',
        needsChange: true,
        editable: true,
      }),
    ]);
    expect(result.summary).toEqual({
      totalFound: 2,
      editable: 1,
      unchanged: 1,
      active: 1,
      paused: 1,
      outOfStock: 1,
      userProduct: 1,
      legacy: 1,
    });
    expect(scanner.scan).toHaveBeenCalledTimes(1);
    expect(stock.updateNew).not.toHaveBeenCalled();
    expect(stock.updateClassic).not.toHaveBeenCalled();
  });
});
