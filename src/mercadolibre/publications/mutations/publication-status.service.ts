import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import { PublicationManagementTargetService } from './publication-management-target.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';
import { runAuditedPublicationMutation } from './publication-mutation-audit.helpers';
import { PublicationSnapshotService } from './publication-snapshot.service';

@Injectable()
export class PublicationStatusService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly sync: PublicationSyncService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Pausa o activa un MLA validado y sincroniza solo su producto o familia. */
  async update(productId: string, body: unknown) {
    const input = parseInput(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const action: 'ACTIVATED' | 'PAUSED' =
      input.status === 'active' ? 'ACTIVATED' : 'PAUSED';
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action,
      oldValue: null as unknown,
      newValue: { status: input.status },
    };

    return runAuditedPublicationMutation(this.activity, audit, async () => {
      const live = await this.targets.getOwnedItem(context);
      audit.oldValue = {
        status: typeof live.status === 'string' ? live.status : null,
        subStatus: Array.isArray(live.sub_status)
          ? live.sub_status.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      };
      assertStatusTransition(live, input.status);
      const response = await this.apiService.put<unknown>(
        `/items/${encodeURIComponent(context.target.itemId)}`,
        { status: input.status },
        context.accessToken,
        input.status === 'active' ? 'activationMutation' : 'statusMutation',
      );
      const item = mutationItemResponse(response, context);
      if (item.status !== input.status) {
        throw new ConflictException(
          'Mercado Libre no aplico el estado solicitado',
        );
      }
      await this.sync.syncKnownItem(item, mutationSyncAccess(context));
      const snapshot = await this.snapshots.persist(context.target, item);
      return { ok: true as const, productId, ...snapshot };
    });
  }
}

function parseInput(body: unknown): {
  status: 'active' | 'paused';
  itemId: unknown;
} {
  if (
    !isJsonObject(body) ||
    (body.status !== 'active' && body.status !== 'paused')
  ) {
    throw new BadRequestException('status debe ser active o paused');
  }
  return { status: body.status, itemId: body.itemId };
}

function assertStatusTransition(
  item: Record<string, unknown>,
  requested: 'active' | 'paused',
): void {
  const current = typeof item.status === 'string' ? item.status : null;
  const subStatuses = Array.isArray(item.sub_status)
    ? item.sub_status.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (current === 'closed') {
    throw new ConflictException(
      'Una publicacion cerrada no se puede reactivar',
    );
  }
  if (current === 'under_review') {
    throw new ConflictException('La publicacion debe resolver su moderacion');
  }
  if (requested === 'active' && subStatuses.includes('out_of_stock')) {
    throw new ConflictException('Repone stock para activar la publicacion');
  }
  if (
    requested === 'active' &&
    subStatuses.some((status) =>
      ['picture_download_pending', 'picture_downloading_pending'].includes(
        status,
      ),
    )
  ) {
    throw new ConflictException(
      'Mercado Libre todavia esta procesando las imagenes',
    );
  }
}
