import { ConflictException, Injectable } from '@nestjs/common';
import {
  PublicationActivityService,
  publicationActionErrorMessage,
} from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isNonEmptyString } from '../../shared/mercadolibre.types';
import {
  auditAttributeValues,
  categoryAttributeDefinitions,
  mergeEditableAttributes,
} from './publication-attribute-policy';
import { parseScopedAttributes } from './publication-content-input';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';

@Injectable()
export class PublicationAttributesService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly sync: PublicationSyncService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Actualiza solo atributos editables y conserva los ya existentes. */
  async update(productId: string, body: unknown) {
    const input = parseScopedAttributes(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const ids = input.attributes.map(({ id }) => id);
    let oldValue: unknown = null;

    try {
      const live = await this.targets.getOwnedItem(context, true);
      const categoryId = category(live.category_id);
      const metadata = await this.apiService.get<unknown>(
        '/categories/' + encodeURIComponent(categoryId) + '/attributes',
        context.accessToken,
      );
      const definitions = categoryAttributeDefinitions(metadata, live);
      oldValue = auditAttributeValues(live.attributes, ids);
      assertContentEditable(live);
      const attributes = mergeEditableAttributes(
        live.attributes,
        definitions,
        input.attributes,
      );
      const response = await this.apiService.put<unknown>(
        '/items/' + encodeURIComponent(context.target.itemId),
        { attributes },
        context.accessToken,
        'attributesMutation',
      );
      const refreshed = mutationItemResponse(response, context);
      await this.sync.syncKnownItem(refreshed, mutationSyncAccess(context));
      await this.snapshots.persist(context.target, refreshed);
      const newValue = auditAttributeValues(refreshed.attributes, ids);
      await this.audit(context, productId, 'SUCCESS', oldValue, newValue);
      return {
        ok: true as const,
        productId,
        itemId: context.target.itemId,
        attributes: newValue,
      };
    } catch (error) {
      await this.audit(
        context,
        productId,
        'FAILED',
        oldValue,
        input.attributes,
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
      action: 'ATTRIBUTES_UPDATED',
      status,
      oldValue,
      newValue,
      errorMessage:
        error === undefined ? null : publicationActionErrorMessage(error),
    });
  }
}

export function assertContentEditable(item: Record<string, unknown>): void {
  const status = isNonEmptyString(item.status) ? item.status.trim() : null;
  if (status === 'closed') {
    throw new ConflictException(
      'Una publicacion cerrada no admite cambios de contenido',
    );
  }
  if (status === 'under_review') {
    throw new ConflictException(
      'La publicacion debe resolver su moderacion antes de editar atributos',
    );
  }
}

function category(value: unknown): string {
  if (!isNonEmptyString(value) || !/^MLA\d+$/.test(value.trim())) {
    throw new ConflictException('El item no tiene una categoria MLA valida');
  }
  return value.trim();
}
