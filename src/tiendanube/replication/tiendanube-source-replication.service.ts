import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../mercadolibre/auth/mercadolibre-token.service';
import { TiendanubeConnectionRepository } from '../connections/tiendanube-connection.repository';
import { TiendanubeApiService } from '../shared/tiendanube-api.service';
import { MercadoLibreReplicationSourceResolver } from './mercadolibre-replication-source-resolver';
import type { SourceLinkRepository } from './tiendanube-product-link.repository';
import { TiendanubeProductLinkRepository } from './tiendanube-product-link.repository';
import { TiendanubeProductResolver } from './tiendanube-product-resolver';
import type { TiendanubeSourceReplicationResult } from './tiendanube-replication-result.types';

type CreatedProduct = Readonly<{ id?: unknown }>;

@Injectable()
export class TiendanubeSourceReplicationService {
  constructor(
    private readonly mercadoLibreTokenService: MercadolibreTokenService,
    private readonly connectionRepository: TiendanubeConnectionRepository,
    private readonly linkRepository: TiendanubeProductLinkRepository,
    private readonly sourceResolver: MercadoLibreReplicationSourceResolver,
    private readonly productResolver: TiendanubeProductResolver,
    private readonly api: TiendanubeApiService,
  ) {}

  async replicate(
    userId: string,
    sourceKey: string,
  ): Promise<TiendanubeSourceReplicationResult> {
    const mlConnection =
      await this.mercadoLibreTokenService.getStoredConnection(userId);
    const tnConnection =
      await this.connectionRepository.findCredentialsByUserId(userId);
    if (!tnConnection?.accessToken.trim())
      throw new UnauthorizedException('Primero conectá Tiendanube');
    const token = await this.mercadoLibreTokenService.getValidAccessToken(
      userId,
      mlConnection,
    );
    const source = await this.sourceResolver.resolve(
      sourceKey,
      mlConnection.seller_id,
      token,
    );
    const links = this.linkRepository as unknown as SourceLinkRepository;
    const context = { userId, storeId: tnConnection.storeId, sourceKey };
    const link = await links.findBySourceKey(context);
    if (link?.status === 'PENDING')
      throw new ConflictException('La replicación está pendiente');
    let productId = link?.tiendanubeProductId ?? null;
    if (
      productId &&
      !(await this.productResolver.exists(tnConnection, productId))
    )
      productId = null;
    if (!productId)
      productId = await this.productResolver.resolve(tnConnection, source.skus);

    if (productId) {
      await this.api.put(
        tnConnection.storeId,
        `/products/${encodeURIComponent(productId)}`,
        source.product,
        tnConnection.accessToken,
      );
      await links.saveSourceLink({
        ...context,
        tiendanubeProductId: productId,
      });
      return {
        ok: true,
        action: 'updated',
        sourceKey,
        tiendanubeProductId: productId,
      };
    }

    const created = await this.api.post<CreatedProduct>(
      tnConnection.storeId,
      '/products',
      source.product,
      tnConnection.accessToken,
    );
    const createdId = parseProductId(created);
    await links.saveSourceLink({ ...context, tiendanubeProductId: createdId });
    return {
      ok: true,
      action: 'created',
      sourceKey,
      tiendanubeProductId: createdId,
    };
  }
}

function parseProductId(value: CreatedProduct | undefined): string {
  if (!value)
    throw new ConflictException('Tiendanube devolvió un producto inválido');
  if (
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0
  )
    return String(value.id);
  if (typeof value.id === 'string' && /^[1-9]\d*$/u.test(value.id))
    return value.id;
  throw new ConflictException('Tiendanube devolvió un producto inválido');
}
