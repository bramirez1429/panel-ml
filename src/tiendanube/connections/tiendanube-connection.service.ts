import { Injectable } from '@nestjs/common';

import { TiendanubeConnectionRepository } from './tiendanube-connection.repository';

export type TiendanubeConnectionStatus =
  | Readonly<{ connected: false }>
  | Readonly<{
      connected: true;
      storeId: string;
      scope: string;
    }>;

@Injectable()
export class TiendanubeConnectionService {
  constructor(
    private readonly connectionRepository: TiendanubeConnectionRepository,
  ) {}

  async getStatus(userId: string): Promise<TiendanubeConnectionStatus> {
    const connection =
      await this.connectionRepository.findSummaryByUserId(userId);

    if (!connection) return { connected: false };

    return {
      connected: true,
      storeId: connection.storeId,
      scope: connection.scope,
    };
  }
}
