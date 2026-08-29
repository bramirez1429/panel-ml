import { describe, expect, it } from '@jest/globals';

import { promotionMatchesRequest } from './promotion-candidate.helpers';

describe('promotionMatchesRequest', () => {
  const request = {
    type: 'DEAL',
    promotionId: 'P-MLA17939038',
    dealPrice: 61418.05,
  } as const;

  it('acepta un candidate DEAL con price 0', () => {
    expect(
      promotionMatchesRequest(
        {
          id: 'P-MLA17939038',
          type: 'DEAL',
          status: 'candidate',
          price: 0,
        },
        request,
        true,
      ),
    ).toBe(true);
  });

  it('acepta un candidate DEAL sin precio definido', () => {
    expect(
      promotionMatchesRequest(
        {
          id: 'P-MLA17939038',
          type: 'DEAL',
          status: 'candidate',
          price: null,
        },
        request,
        true,
      ),
    ).toBe(true);
  });

  it('acepta un precio fijo cuando coincide', () => {
    expect(
      promotionMatchesRequest(
        {
          id: 'P-MLA17939038',
          type: 'DEAL',
          status: 'candidate',
          price: 61418.05,
        },
        request,
        true,
      ),
    ).toBe(true);
  });

  it('rechaza un precio fijo diferente', () => {
    expect(
      promotionMatchesRequest(
        {
          id: 'P-MLA17939038',
          type: 'DEAL',
          status: 'candidate',
          price: 60000,
        },
        request,
        true,
      ),
    ).toBe(false);
  });
});
