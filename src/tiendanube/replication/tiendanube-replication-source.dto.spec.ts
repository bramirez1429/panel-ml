import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  TiendanubePriceMode,
  TiendanubeReplicationOptionsDto,
  TiendanubeTagMode,
} from './tiendanube-replication-source.dto';

describe('TiendanubeReplicationOptionsDto tags', () => {
  it('recorta tags válidos en modo OVERRIDE', async () => {
    const options = createOptions({ tags: [' remera ', ' algodón '] });

    await expect(validate(options)).resolves.toHaveLength(0);
    expect(options.tags).toEqual(['remera', 'algodón']);
  });

  it.each([
    ['tags ausentes', undefined],
    ['array vacío', []],
    ['tag vacío', ['']],
    ['tag con espacios', ['   ']],
    ['valor no string', ['remera', 1]],
  ])('rechaza OVERRIDE con %s', async (_case, tags) => {
    const options = createOptions({ tags });

    await expect(validate(options)).resolves.not.toHaveLength(0);
  });
});

function createOptions(
  override: Readonly<Record<string, unknown>>,
): TiendanubeReplicationOptionsDto {
  return plainToInstance(TiendanubeReplicationOptionsDto, {
    priceMode: TiendanubePriceMode.KEEP_SOURCE,
    categoryId: 88,
    tagMode: TiendanubeTagMode.OVERRIDE,
    ...override,
  });
}
