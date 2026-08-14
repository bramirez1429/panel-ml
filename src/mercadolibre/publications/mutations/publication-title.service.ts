import { ConflictException, Injectable } from '@nestjs/common';
import {
  PublicationActivityService,
  publicationActionErrorMessage,
} from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isNonEmptyString } from '../../shared/mercadolibre.types';
import { parseScopedText } from './publication-content-input';
import { PublicationManagementTargetService } from './publication-management-target.service';
import { PublicationSnapshotService } from './publication-snapshot.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';

@Injectable()
export class PublicationTitleService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly sync: PublicationSyncService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Actualiza el titulo solo cuando el estado vivo permite intentarlo. */
  async update(productId: string, body: unknown) {
    const input = parseScopedText(body, 'title', 500);
    const context = await this.targets.resolve(productId, input.itemId);
    let oldTitle: string | null = null;

    try {
      const live = await this.targets.getOwnedItem(context);
      oldTitle = text(live.title);
      assertTitleEditable(live);
      const response = await this.apiService.put<unknown>(
        '/items/' + encodeURIComponent(context.target.itemId),
        { title: input.value },
        context.accessToken,
        'titleMutation',
      );
      const refreshed = mutationItemResponse(response, context);
      const title = text(refreshed.title);
      if (normalized(title) !== normalized(input.value)) {
        throw new ConflictException(
          'Mercado Libre no aplico el titulo solicitado',
        );
      }
      await this.sync.syncKnownItem(refreshed, mutationSyncAccess(context));
      await this.snapshots.persist(context.target, refreshed);
      await this.audit(context, productId, 'SUCCESS', oldTitle, title);
      return {
        ok: true as const,
        productId,
        itemId: context.target.itemId,
        title,
      };
    } catch (error) {
      await this.audit(
        context,
        productId,
        'FAILED',
        oldTitle,
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
      action: 'TITLE_UPDATED',
      status,
      oldValue: { title: oldValue },
      newValue: { title: newValue },
      errorMessage:
        error === undefined ? null : publicationActionErrorMessage(error),
    });
  }
}

/** Explica si el estado vivo admite cambiar el titulo. */
export function titleEditability(item: Record<string, unknown>) {
  if (text(item.family_name)) {
    return {
      editable: false,
      reason: 'User Products genera el titulo desde family_name y atributos',
    };
  }
  if (
    number(item.sold_quantity) > 0 &&
    number(item.official_store_id) <= 0
  ) {
    return {
      editable: false,
      reason: 'Mercado Libre no permite cambiar el titulo luego de una venta',
    };
  }
  if (text(item.status) === 'closed') {
    return {
      editable: false,
      reason: 'Una publicacion cerrada no admite cambios de titulo',
    };
  }
  if (text(item.status) === 'under_review') {
    return {
      editable: false,
      reason: 'La publicacion debe resolver su moderacion antes de editar',
    };
  }
  const status = text(item.status);
  if (status && !['active', 'paused'].includes(status)) {
    return {
      editable: false,
      reason: 'El estado actual no admite cambios de titulo',
    };
  }
  return { editable: true, reason: null };
}

function assertTitleEditable(item: Record<string, unknown>): void {
  const capability = titleEditability(item);
  if (!capability.editable) {
    throw new ConflictException(
      capability.reason ?? 'Mercado Libre no permite editar el titulo',
    );
  }
}

function normalized(value: string | null): string {
  return (value ?? '').replaceAll(/\s+/g, ' ').trim();
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string | null {
  return isNonEmptyString(value) ? value.trim() : null;
}
