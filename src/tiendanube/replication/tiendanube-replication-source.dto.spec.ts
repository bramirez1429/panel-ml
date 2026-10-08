import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  TiendanubePriceMode,
  TiendanubeReplicationOptionsDto,
  TiendanubeTagMode,
} from './tiendanube-replication-source.dto';

describe('TiendanubeReplicationOptionsDto tags', () => {
  it('recorta un título y acepta un precio promocional positivo', async () => {
    const options = createOptions({
      title: '  Remera  ',
      promotionalPrice: 99.5,
    });

    await expect(validate(options)).resolves.toHaveLength(0);
    expect(options.title).toBe('Remera');
  });

  it.each([
    ['título vacío', { title: '   ' }],
    ['promoción cero', { promotionalPrice: 0 }],
    ['promoción negativa', { promotionalPrice: -1 }],
  ])('rechaza %s', async (_case, override) => {
    await expect(validate(createOptions(override))).resolves.not.toHaveLength(0);
  });

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
