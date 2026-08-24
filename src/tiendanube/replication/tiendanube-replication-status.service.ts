import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import type {
  TiendanubeReplicationStatusItem,
  TiendanubeReplicationStatusResponse,
} from './tiendanube-replication-status.types';

const MAX_PRODUCT_IDS = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class TiendanubeReplicationStatusService {
  constructor(
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly productLinkRepository: TiendanubeProductLinkRepository,
  ) {}

  async getStatus(
    userId: string,
    rawProductIds: string,
  ): Promise<TiendanubeReplicationStatusResponse> {
    const productIds = parseProductIds(rawProductIds);
    const connection =
      await this.connectionRepository.findSummaryByUserId(userId);

    if (!connection?.storeId.trim()) {
      throw new UnauthorizedException(
        'Primero conectá Tiendanube desde /tiendanube/connect',
      );
    }

    const records = await this.productLinkRepository.findStatusesByMlProductIds(
      {
        userId,
        storeId: connection.storeId,
        mlProductIds: productIds,
      },
    );
    const requestedIds = new Set(productIds);
    const statusByProductId = new Map(
      records.map((record) => {
        if (
          !requestedIds.has(record.mlProductId) ||
          (record.status === 'COMPLETED' && !record.tiendanubeProductId?.trim())
        ) {
          throwStatusReadError();
        }
        return [record.mlProductId, record] as const;
      }),
    );
    if (statusByProductId.size !== records.length) throwStatusReadError();

    return {
      items: productIds.map((mlProductId) =>
        toPublicStatusItem(mlProductId, statusByProductId.get(mlProductId)),
      ),
    };
  }
}

function parseProductIds(rawValue: string): string[] {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new BadRequestException('productIds no puede estar vacío');
  }

  const candidates = rawValue.split(',').map((value) => value.trim());
  if (candidates.length > MAX_PRODUCT_IDS) {
    throw new BadRequestException('productIds admite como máximo 100 IDs');
  }
  if (candidates.some((value) => !UUID_PATTERN.test(value))) {
    throw new BadRequestException('productIds contiene un UUID inválido');
  }

  return [...new Set(candidates.map((value) => value.toLowerCase()))];
}

function toPublicStatusItem(
  mlProductId: string,
  record:
    | Awaited<
        ReturnType<
          TiendanubeProductLinkRepository['findStatusesByMlProductIds']
        >
      >[number]
    | undefined,
): TiendanubeReplicationStatusItem {
  if (!record) return { mlProductId, status: 'NOT_REPLICATED' };
  if (record.status !== 'COMPLETED') {
    return { mlProductId, status: record.status };
  }
  if (!record.tiendanubeProductId) throwStatusReadError();
  return {
    mlProductId,
    status: 'COMPLETED',
    tiendanubeProductId: record.tiendanubeProductId,
  };
}

function throwStatusReadError(): never {
  throw new ServiceUnavailableException(
    'No se pudo leer el estado de replicación de Tiendanube',
  );
}
