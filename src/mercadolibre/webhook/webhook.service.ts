import { Injectable, Logger } from '@nestjs/common';
import { PublicationSyncService } from '../publications/sync/publication-sync.service';
import { isJsonObject } from '../shared/mercadolibre.types';

type ItemNotification = {
  itemId: string;
  sellerId: number;
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly pending = new Map<string, boolean>();

  /** Recibe el servicio que sincroniza publicaciones puntuales. */
  constructor(private readonly syncService: PublicationSyncService) {}

  /** Recibe una notificaci\u00f3n y dispara el trabajo sin esperar. */
  receive(payload: unknown): void {
    const notification = parseItemNotification(payload);
    if (!notification) return;

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
function parseItemNotification(payload: unknown): ItemNotification | null {
  if (
    !isJsonObject(payload) ||
    !['items', 'items_prices'].includes(String(payload.topic))
  ) {
    return null;
  }
  if (
    typeof payload.user_id !== 'number' ||
    !Number.isSafeInteger(payload.user_id) ||
    payload.user_id <= 0 ||
    typeof payload.resource !== 'string'
  ) {
    return null;
  }

  const match = /^\/items\/(MLA\d+)$/.exec(payload.resource);
  if (!match) return null;
  return { itemId: match[1], sellerId: payload.user_id };
}
