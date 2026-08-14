import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import {
  runAuditedPublicationMutation,
  stockAuditValue,
} from './publication-mutation-audit.helpers';
import {
  PublicationManagementContext,
  PublicationManagementTargetService,
} from './publication-management-target.service';
import { parsePublicationUpdateVariations } from './publication-update-variations.helpers';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';
import {
  createItemStockPayload,
  parsePublicationStockInput,
  parsePublicationStockLocations,
  publicationStockUserProductId,
  publicationWarehouseError,
  validatePublicationStockSelector,
} from './publication-stock.helpers';

@Injectable()
export class PublicationStockService {
  /** Recibe cambios de stock validados para una publicación segura. */
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly syncService: PublicationSyncService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Actualiza stock por item o selling_address y sincroniza el item afectado. */
  async update(productId: string, body: unknown) {
    const input = parsePublicationStockInput(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'STOCK_UPDATED' as const,
      oldValue: null as unknown,
      newValue: { stock: input.stock, variationId: input.variationId },
    };

    return runAuditedPublicationMutation(this.activity, audit, async () => {
      validatePublicationStockSelector(context.product, input.variationId);
      const item = await this.targets.getOwnedItem(context);
      const variations = parsePublicationUpdateVariations(item.variations);
      const itemPayload = createItemStockPayload(input, variations);
      audit.oldValue = stockAuditValue(item, input.variationId);

      const userProductId = publicationStockUserProductId(
        context,
        input,
        variations,
      );
      const distributed = await this.updateDistributedStock(
        context,
        userProductId,
        input.stock,
      );
      if (!distributed) {
        await this.assertItemStockManagement(context);
        const response = await this.apiService.put<unknown>(
          `/items/${encodeURIComponent(context.target.itemId)}`,
          itemPayload,
          context.accessToken,
          'stockMutation',
        );
        const publication = mutationItemResponse(response, context);
        await this.syncService.syncKnownItem(
          publication,
          mutationSyncAccess(context),
        );
      } else {
        await this.syncService.syncItem(
          context.target.itemId,
          context.sellerId,
        );
      }
      return {
        ok: true as const,
        productId,
        itemId: context.target.itemId,
        field: 'stock' as const,
        value: input.stock,
      };
    });
  }

  // Actualiza selling_address cuando el User Product tiene stock distribuido.
  private async updateDistributedStock(
    context: PublicationManagementContext,
    userProductId: string | null,
    stock: number,
  ): Promise<boolean> {
    if (!userProductId) return false;

    const path = `/user-products/${encodeURIComponent(userProductId)}/stock`;
    const response = await this.apiService.getWithHeaders<unknown>(
      path,
      context.accessToken,
      true,
    );
    const locations = parsePublicationStockLocations(response.data);
    if (locations.length === 0) return false;
    if (locations.includes('seller_warehouse')) {
      throw publicationWarehouseError();
    }
    if (locations.every((location) => location === 'meli_facility')) {
      throw new ConflictException(
        'Esta publicación administra el stock mediante Full',
      );
    }
    if (!locations.includes('selling_address')) {
      throw publicationWarehouseError();
    }

    const version = response.headers.get('x-version');
    if (!version || !/^\d+$/.test(version)) {
      throw new BadGatewayException(
        'Mercado Libre no informó la versión actual del stock',
      );
    }
    await this.apiService.putWithHeaders<unknown>(
      `${path}/type/selling_address`,
      { quantity: stock },
      context.accessToken,
      { 'x-version': version },
      'stockMutation',
    );
    return true;
  }

  // Bloquea el PUT por item cuando el seller administra depósitos.
  private async assertItemStockManagement(
    context: PublicationManagementContext,
  ): Promise<void> {
    const user = await this.apiService.get<unknown>(
      `/users/${context.sellerId}`,
      context.accessToken,
    );
    if (
      !isJsonObject(user) ||
      user.id !== context.sellerId ||
      !Array.isArray(user.tags) ||
      user.tags.some((tag) => typeof tag !== 'string')
    ) {
      throw new BadGatewayException('Respuesta de vendedor inválida');
    }
    if (user.tags.includes('warehouse_management')) {
      throw publicationWarehouseError();
    }
  }
}
