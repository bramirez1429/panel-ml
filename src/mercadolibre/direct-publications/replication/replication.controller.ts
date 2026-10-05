import { Controller, Get, UseGuards } from '@nestjs/common';

import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { ReplicationCatalogService } from './replication-catalog.service';
import type { DirectReplicationProduct } from './replication.types';

@Controller('mercadolibre/direct/replicar')
@UseGuards(AccessTokenGuard)
export class ReplicationController {
  constructor(private readonly service: ReplicationCatalogService) {}

  @Get()
  getProducts(): Promise<DirectReplicationProduct[]> {
    return this.service.getProducts();
  }
}
