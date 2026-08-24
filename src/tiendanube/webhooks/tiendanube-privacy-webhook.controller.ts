import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Post,
  RawBody,
} from '@nestjs/common';

import { TiendanubePrivacyWebhookService } from './tiendanube-privacy-webhook.service';

type TiendanubeWebhookResponse = Readonly<{ ok: true }>;

const OK_RESPONSE: TiendanubeWebhookResponse = { ok: true };

@Controller('tiendanube/webhooks')
export class TiendanubePrivacyWebhookController {
  constructor(
    private readonly privacyWebhookService: TiendanubePrivacyWebhookService,
  ) {}

  @Post('store-redact')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async storeRedact(
    @RawBody() rawBody: Buffer | undefined,
    @Headers('x-linkedstore-hmac-sha256') signature: unknown,
    @Body() payload: unknown,
  ): Promise<TiendanubeWebhookResponse> {
    await this.privacyWebhookService.handleStoreRedact({
      rawBody,
      signature,
      payload,
    });
    return OK_RESPONSE;
  }

  @Post('customers-redact')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  customersRedact(
    @RawBody() rawBody: Buffer | undefined,
    @Headers('x-linkedstore-hmac-sha256') signature: unknown,
    @Body() payload: unknown,
  ): TiendanubeWebhookResponse {
    this.privacyWebhookService.handleCustomersRedact({
      rawBody,
      signature,
      payload,
    });
    return OK_RESPONSE;
  }

  @Post('customers-data-request')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  customersDataRequest(
    @RawBody() rawBody: Buffer | undefined,
    @Headers('x-linkedstore-hmac-sha256') signature: unknown,
    @Body() payload: unknown,
  ): TiendanubeWebhookResponse {
    this.privacyWebhookService.handleCustomersDataRequest({
      rawBody,
      signature,
      payload,
    });
    return OK_RESPONSE;
  }
}
