import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { TiendanubeProductsCatalogQueryDto } from './tiendanube-products-catalog-query.dto';

describe('TiendanubeProductsCatalogQueryDto', () => {
  it('uses defaults and trims the search query', async () => {
    const query = plainToInstance(TiendanubeProductsCatalogQueryDto, {
      q: '  remera azul  ',
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query).toMatchObject({ page: 1, limit: 20, q: 'remera azul' });
  });

  it.each([
    ['page zero', { page: '0' }],
    ['limit above maximum', { limit: '201' }],
    ['empty search', { q: '   ' }],
  ])('rejects %s', async (_case, input) => {
    const query = plainToInstance(TiendanubeProductsCatalogQueryDto, input);

    await expect(validate(query)).resolves.not.toHaveLength(0);
  });
});
