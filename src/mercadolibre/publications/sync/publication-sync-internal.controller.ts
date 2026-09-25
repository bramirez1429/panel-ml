import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicationAutomaticSyncService } from './publication-automatic-sync.service';

@Controller('internal/mercadolibre/publicaciones/sync')
export class PublicationSyncInternalController {
  constructor(
    private readonly config: ConfigService,
    private readonly automaticSync: PublicationAutomaticSyncService,
  ) {}

  @Get('automatic')
  run(@Headers('authorization') authorization?: string) {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Cron no autorizado');
    }
    return this.automaticSync.run();
  }
}
