import { Injectable, Logger } from '@nestjs/common';
import { MercadolibreSaleIngestionService } from '../../sales/mercadolibre-sale-ingestion.service';
import { PublicationSyncService } from '../publications/sync/publication-sync.service';
import { isJsonObject } from '../shared/mercadolibre.types';

type ItemNotification = {
  type: 'ITEM';
  itemId: string;
  sellerId: number;
};

type OrderNotification = {
  type: 'ORDER';
  orderId: string;
  sellerId: number;
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly pending = new Map<string, boolean>();

  /** Recibe el servicio que sincroniza publicaciones puntuales. */
  constructor(
    private readonly syncService: PublicationSyncService,
    private readonly saleIngestion: MercadolibreSaleIngestionService,
  ) {}

  /** Recibe una notificaci\u00f3n y dispara el trabajo sin esperar. */
  receive(payload: unknown): void {
    const notification = parseNotification(payload);
    if (!notification) return;

    if (notification.type === 'ORDER') {
      this.saleIngestion.receive(notification.orderId, notification.sellerId);
      return;
    }

    const key = `${notification.sellerId}:${notification.itemId}`;
    if (this.pending.has(key)) {
      this.pending.set(key, true);
      return;
    }
    this.pending.set(key, false);
    void this.process(key, notification);
  }

  /** Repite si el MLA cambi\u00f3 mientras estaba sincroniz\u00e1ndose. */
  private async process(
    key: string,
    notification: ItemNotification,
  ): Promise<void> {
    try {
      do {
        this.pending.set(key, false);
        try {
          await this.syncService.syncItem(
            notification.itemId,
            notification.sellerId,
          );
        } catch {
          this.logger.warn(
            `No se pudo sincronizar la publicaci\u00f3n ${notification.itemId}`,
          );
        }
      } while (this.pending.get(key) === true);
    } finally {
      this.pending.delete(key);
    }
  }
}

/** Extrae solamente notificaciones v\u00e1lidas de \u00edtems. */
function parseNotification(
  payload: unknown,
): ItemNotification | OrderNotification | null {
  if (!isJsonObject(payload)) return null;
  if (
    typeof payload.user_id !== 'number' ||
    !Number.isSafeInteger(payload.user_id) ||
    payload.user_id <= 0 ||
    typeof payload.resource !== 'string'
  ) {
    return null;
  }

  if (payload.topic === 'items') {
    const match = /^\/items\/(MLA\d+)$/.exec(payload.resource);
    return match
      ? { type: 'ITEM', itemId: match[1], sellerId: payload.user_id }
      : null;
  }
  if (payload.topic === 'orders_v2') {
    const match = /^\/orders\/([1-9]\d*)$/.exec(payload.resource);
    return match
      ? { type: 'ORDER', orderId: match[1], sellerId: payload.user_id }
      : null;
  }
  return null;
}
