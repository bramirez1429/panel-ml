import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('mercadolibre')
export class WebhookController {
  /** Recibe el servicio que procesa las notificaciones. */
  constructor(private readonly webhookService: WebhookService) {}

  /** Confirma la notificación y delega el trabajo en segundo plano. */
  @Post('webhook')
  @HttpCode(200)
  receive(@Body() payload: unknown): { ok: true } {
    this.webhookService.receive(payload);
    return { ok: true };
  }
}
