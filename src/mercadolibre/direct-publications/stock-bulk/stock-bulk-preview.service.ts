import { Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { StockBulkPreviewStockService } from './stock-bulk-preview-stock.service';
import { StockBulkTargetsService } from './stock-bulk-targets.service';
import type {
  StockBulkPreview,
  StockBulkPreviewRequest,
  StockBulkTarget,
} from './stock-bulk.types';

@Injectable()
export class StockBulkPreviewService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly scanner: PublicationCatalogScannerService,
    private readonly targetsService: StockBulkTargetsService,
    private readonly previewStockService: StockBulkPreviewStockService,
  ) {}

  async preview(
    userId: string,
    request: StockBulkPreviewRequest,
  ): Promise<StockBulkPreview> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );
    const matches: StockBulkTarget[] = [];
    await this.scanner.scan(
      connection.seller_id,
      accessToken,
      undefined,
      (items) => {
        matches.push(...this.targetsService.collect(items, request));
        return false;
      },
    );
    const results = await this.previewStockService.resolve(
      accessToken,
      deduplicate(matches),
    );
    return {
      productType: request.productType,
      results,
      summary: summarize(results),
    };
  }
}

function deduplicate(targets: readonly StockBulkTarget[]): StockBulkTarget[] {
  return [
    ...new Map(targets.map((target) => [target.identifier, target])).values(),
  ];
}

function summarize(results: readonly StockBulkTarget[]) {
  return {
    totalFound: results.length,
    editable: results.filter((target) => target.editable && target.needsChange)
      .length,
    unchanged: results.filter((target) => !target.needsChange).length,
    active: results.filter((target) => target.currentStatus === 'active')
      .length,
    paused: results.filter((target) => target.currentStatus === 'paused')
      .length,
    outOfStock: results.filter((target) => target.currentQuantity === 0).length,
    userProduct: results.filter((target) => target.model === 'USER_PRODUCT')
      .length,
    legacy: results.filter((target) => target.model === 'LEGACY').length,
  };
}
