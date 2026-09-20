import { UnauthorizedException } from '@nestjs/common';

import {
  PRODUCT_RANKING_VISITS_BATCH_SIZE,
  ProductRankingVisitsService,
} from './product-ranking-visits.service';

describe('ProductRankingVisitsService', () => {
  it('consulta MLA únicos, conserva cero y usa un rango de 150 días', async () => {
    const apiService = {
      get: jest.fn().mockResolvedValue([
        { item_id: 'MLA1', total_visits: 1250 },
        { item_id: 'MLA2', total_visits: 0 },
      ]),
    };
    const service = new ProductRankingVisitsService(apiService as never);

    const result = await service.getVisits(
      ['MLA1', 'MLA1', 'MLA2'],
      'token',
      150,
      new Date('2026-09-19T12:00:00.000Z'),
    );

    expect(result).toEqual(
      new Map([
        ['MLA1', 1250],
        ['MLA2', 0],
      ]),
    );
    const path = apiService.get.mock.calls[0][0] as string;
    const url = new URL(path, 'https://api.mercadolibre.com');
    expect(url.searchParams.get('ids')).toBe('MLA1,MLA2');
    expect(url.searchParams.get('date_to')).toBe('2026-09-19T12:00:00.000Z');
    expect(url.searchParams.get('date_from')).toBe(
      '2026-04-22T12:00:00.000Z',
    );
  });

  it('divide el catálogo en batches conservadores', async () => {
    const apiService = { get: jest.fn().mockResolvedValue([]) };
    const service = new ProductRankingVisitsService(apiService as never);
    const itemIds = Array.from(
      { length: PRODUCT_RANKING_VISITS_BATCH_SIZE + 1 },
      (_, index) => `MLA${index + 1}`,
    );

    await service.getVisits(itemIds, 'token', 30);

    expect(apiService.get).toHaveBeenCalledTimes(2);
  });

  it('representa como null un fallo exclusivo de visitas', async () => {
    const apiService = {
      get: jest.fn().mockRejectedValue(new Error('visits unavailable')),
    };
    const service = new ProductRankingVisitsService(apiService as never);

    await expect(service.getVisits(['MLA1'], 'token', 30)).resolves.toEqual(
      new Map([['MLA1', null]]),
    );
  });

  it('propaga errores de autenticación', async () => {
    const authenticationError = new UnauthorizedException();
    const apiService = {
      get: jest.fn().mockRejectedValue(authenticationError),
    };
    const service = new ProductRankingVisitsService(apiService as never);

    await expect(service.getVisits(['MLA1'], 'token', 30)).rejects.toBe(
      authenticationError,
    );
  });
});
