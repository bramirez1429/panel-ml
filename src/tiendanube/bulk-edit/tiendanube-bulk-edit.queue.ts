import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { send } from '@vercel/queue';
import { TiendanubeBulkEditService } from './tiendanube-bulk-edit.service';

export const TIENDANUBE_BULK_EDIT_QUEUE_TOPIC = 'tiendanube-bulk-edit';
export type TiendanubeBulkEditQueueMessage = Readonly<{ jobId: string; executionToken: string }>;
@Injectable()
export class TiendanubeBulkEditQueue {
  constructor(@Inject(forwardRef(() => TiendanubeBulkEditService)) private readonly service: TiendanubeBulkEditService) {}
  async enqueue(message: TiendanubeBulkEditQueueMessage, delaySeconds?: number) {
    if (delaySeconds === undefined) return send(TIENDANUBE_BULK_EDIT_QUEUE_TOPIC, message);
    return send(TIENDANUBE_BULK_EDIT_QUEUE_TOPIC, message, { delaySeconds });
  }
  async consume(message: TiendanubeBulkEditQueueMessage) {
    const next = await this.service.processNext(message.jobId, message.executionToken);
    if (next.hasMore) await this.enqueue(message, next.delaySeconds ?? 1);
  }
}
