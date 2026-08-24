import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import {
  getRequiredTiendanubeConfig,
  TiendanubeEnvironment,
} from '../shared/tiendanube.config';
import {
  parseCustomerPrivacyPayload,
  parseStoreRedactPayload,
  TiendanubeIncomingWebhook,
} from './tiendanube-privacy-webhook.types';

const HMAC_SHA256_PATTERN = /^[0-9a-f]{64}$/i;

@Injectable()
export class TiendanubePrivacyWebhookService {
  constructor(
    private readonly configService: ConfigService<TiendanubeEnvironment>,
    private readonly connectionRepository: TiendanubeConnectionRepository,
  ) {}

  async handleStoreRedact(webhook: TiendanubeIncomingWebhook): Promise<void> {
    this.verifyAuthenticity(webhook.rawBody, webhook.signature);
    const payload = parseStoreRedactPayload(webhook.payload);
    if (!payload) this.invalidPayload();

    await this.connectionRepository.deleteByStoreId(payload.storeId);
  }

  handleCustomersRedact(webhook: TiendanubeIncomingWebhook): void {
    this.verifyAuthenticity(webhook.rawBody, webhook.signature);
    if (!parseCustomerPrivacyPayload(webhook.payload)) this.invalidPayload();
  }

  handleCustomersDataRequest(webhook: TiendanubeIncomingWebhook): void {
    this.verifyAuthenticity(webhook.rawBody, webhook.signature);
    if (!parseCustomerPrivacyPayload(webhook.payload)) this.invalidPayload();
  }

  private verifyAuthenticity(
    rawBody: Buffer | undefined,
    signature: unknown,
  ): void {
    if (typeof signature !== 'string') this.unauthorized();

    const normalizedSignature = signature.trim().toLowerCase();
    if (!HMAC_SHA256_PATTERN.test(normalizedSignature)) this.unauthorized();
    if (!Buffer.isBuffer(rawBody)) {
      throw new ServiceUnavailableException(
        'No se pudo validar el webhook de Tiendanube',
      );
    }

    const expectedSignature = createHmac(
      'sha256',
      getRequiredTiendanubeConfig(
        this.configService,
        'TIENDANUBE_CLIENT_SECRET',
      ),
    )
      .update(rawBody)
      .digest('hex');
    const receivedBuffer = Buffer.from(normalizedSignature, 'ascii');
    const expectedBuffer = Buffer.from(expectedSignature, 'ascii');

    if (
      receivedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      this.unauthorized();
    }
  }

  private invalidPayload(): never {
    throw new BadRequestException('Payload de webhook de Tiendanube inválido');
  }

  private unauthorized(): never {
    throw new UnauthorizedException('Webhook de Tiendanube no autenticado');
  }
}
