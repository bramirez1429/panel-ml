import { ConflictException, Injectable } from '@nestjs/common';
import {
  PublicationActivityService,
  publicationActionErrorMessage,
} from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { parseScopedText } from './publication-content-input';
import { PublicationLiveContentService } from './publication-live-content.service';
import { PublicationManagementTargetService } from './publication-management-target.service';

@Injectable()
export class PublicationDescriptionService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly liveContent: PublicationLiveContentService,
    private readonly sync: PublicationSyncService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Actualiza la descripcion mediante el recurso oficial de Mercado Libre. */
  async update(productId: string, body: unknown) {
    const input = parseScopedText(body, 'description', 50_000, true);
    const context = await this.targets.resolve(productId, input.itemId);
    let oldDescription: string | null = null;

    try {
      await this.targets.getOwnedItem(context);
      oldDescription = await this.liveContent.getDescription(
        context.target.itemId,
        context.accessToken,
      );
      const path =
        '/items/' + encodeURIComponent(context.target.itemId) + '/description';
      if (oldDescription === null) {
        await this.apiService.post<unknown>(
          path,
          { plain_text: input.value },
          context.accessToken,
          'descriptionMutation',
        );
      } else {
        await this.apiService.put<unknown>(
          path + '?api_version=2',
          { plain_text: input.value },
          context.accessToken,
          'descriptionMutation',
        );
      }
      await this.sync.syncItem(context.target.itemId, context.sellerId);
      const description = await this.liveContent.getDescription(
        context.target.itemId,
        context.accessToken,
      );
      if (description !== input.value) {
        throw new ConflictException(
          'Mercado Libre no aplico la descripcion solicitada',
        );
      }
      await this.audit(
        context,
        productId,
        'SUCCESS',
        oldDescription,
        description,
      );
      return {
        ok: true as const,
        productId,
        itemId: context.target.itemId,
        description,
      };
    } catch (error) {
      await this.audit(
        context,
        productId,
        'FAILED',
        oldDescription,
        input.value,
        error,
      );
      throw error;
    }
  }

  private audit(
    context: Awaited<ReturnType<PublicationManagementTargetService['resolve']>>,
    productId: string,
    status: 'SUCCESS' | 'FAILED',
    oldValue: unknown,
    newValue: unknown,
    error?: unknown,
  ) {
    return this.activity.recordBestEffort({
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'DESCRIPTION_UPDATED',
      status,
      oldValue: { description: oldValue },
      newValue: { description: newValue },
      errorMessage:
        error === undefined ? null : publicationActionErrorMessage(error),
    });
  }
}
