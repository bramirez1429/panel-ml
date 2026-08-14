import { BadGatewayException } from '@nestjs/common';
import { PublicationManagementContext } from './publication-management-target.service';
import { mutationItemResponse } from './publication-mutation-response';

const CONTEXT = {
  product: { id: 'product-id', model: 'VARIANT_PRICING' },
  target: {
    productId: 'product-id',
    model: 'VARIANT_PRICING',
    itemId: 'MLA200',
    userProductId: 'MLAU300',
  },
  sellerId: 123,
  accessToken: 'access-token',
} as unknown as PublicationManagementContext;

describe('mutationItemResponse', () => {
  it('acepta el MLA, seller y User Product esperados', () => {
    const response = {
      id: 'MLA200',
      seller_id: 123,
      user_product_id: 'MLAU300',
    };

    expect(mutationItemResponse(response, CONTEXT)).toBe(response);
  });

  it('rechaza una respuesta con otro User Product antes del sync', () => {
    const response = {
      id: 'MLA200',
      seller_id: 123,
      user_product_id: 'MLAU999',
    };

    expect(() => mutationItemResponse(response, CONTEXT)).toThrow(
      BadGatewayException,
    );
  });
});
