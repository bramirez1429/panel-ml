import { BadGatewayException } from '@nestjs/common';
import type { MercadoLibrePublication } from '../publication.types';
import { isJsonObject } from '../../shared/mercadolibre.types';
import type { PublicationManagementContext } from './publication-management-target.service';

/** Valida que el PUT devolvió el mismo MLA, seller y User Product. */
export function mutationItemResponse(
  value: unknown,
  context: PublicationManagementContext,
): MercadoLibrePublication {
  if (
    !isJsonObject(value) ||
    value.id !== context.target.itemId ||
    value.seller_id !== context.sellerId ||
    (context.target.userProductId !== null &&
      value.user_product_id !== context.target.userProductId)
  ) {
    throw new BadGatewayException(
      'Mercado Libre devolvió una publicación inválida',
    );
  }
  return value;
}

/** Expone seller y token ya validados para una sincronización dirigida. */
export function mutationSyncAccess(context: PublicationManagementContext) {
  return {
    sellerId: context.sellerId,
    accessToken: context.accessToken,
  };
}
