import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { PublicationCatalogScannerService } from '../publications/publication-catalog-scanner.service';
import { StockBulkPreviewStockService } from './stock-bulk-preview-stock.service';
import { StockBulkTargetsService } from './stock-bulk-targets.service';
import type {
  StockBulkPreview,
  StockBulkPreviewRequest,
  StockBulkCatalogRequest,
  StockBulkSelectionPreviewRequest,
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

  /** Lista todas las variantes activas del tipo de producto, sin modificar stock. */
  async catalog(
    userId: string,
    request: StockBulkCatalogRequest,
  ): Promise<StockBulkPreview> {
    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(userId, connection);
    const matches: StockBulkTarget[] = [];
    await this.scanner.scanActive(
      connection.seller_id,
      accessToken,
      (items) => {
        matches.push(...this.targetsService.collectCatalog(items, request.productType));
        return false;
      },
    );
    const results = await this.previewStockService.resolve(accessToken, deduplicate(matches));
    return { productType: request.productType, results, summary: summarize(results) };
  }

  /** Revalida en ML la selección antes de preparar el job; no realiza escrituras. */
  async selectionPreview(
    userId: string,
    request: StockBulkSelectionPreviewRequest,
  ): Promise<StockBulkPreview> {
    const catalog = await this.catalog(userId, { productType: request.productType });
    const byIdentifier = new Map(catalog.results.map((target) => [target.identifier, target]));
    if (request.identifiers.some((identifier) => !byIdentifier.has(identifier))) {
      throw new BadRequestException('Una o más variantes ya no están activas o disponibles. Volvé a cargar el catálogo.');
    }
    const results = request.identifiers.map((identifier) => {
      const target = byIdentifier.get(identifier)!;
      return {
        ...target,
        requestedQuantity: request.quantity,
        needsChange: target.currentQuantity !== request.quantity,
      };
    });
    return { productType: request.productType, results, summary: summarize(results) };
  }

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
    await this.scanner.scanActiveAndPaused(
      connection.seller_id,
      accessToken,
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
