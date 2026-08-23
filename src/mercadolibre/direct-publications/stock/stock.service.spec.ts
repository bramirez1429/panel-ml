import { BadRequestException } from '@nestjs/common';

import { StockService } from './stock.service';

describe('StockService.updateClassic', () => {
  const tokenService = { getValidAccessToken: jest.fn() };
  const itemsService = { getOne: jest.fn() };
  const apiService = { put: jest.fn() };
  let service: StockService;

  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.getValidAccessToken.mockResolvedValue('token');
    service = new StockService(
      tokenService as never,
      apiService as never,
      itemsService as never,
    );
  });

  it('preserva los IDs S/M/L/XL y modifica solamente el stock de S', async () => {
    const variations = [
      {
        id: 181000000001,
        available_quantity: 3,
        sold_quantity: 2,
        attribute_combinations: [{ id: 'SIZE', value_name: 'S' }],
      },
      {
        id: 181000000002,
        available_quantity: 7,
        sold_quantity: 1,
        attribute_combinations: [{ id: 'SIZE', value_name: 'M' }],
      },
      {
        id: 181000000003,
        available_quantity: 11,
        sold_quantity: 0,
        attribute_combinations: [{ id: 'SIZE', value_name: 'L' }],
      },
      {
        id: 181000000004,
        available_quantity: 13,
        sold_quantity: 4,
        attribute_combinations: [{ id: 'SIZE', value_name: 'XL' }],
      },
    ];
    itemsService.getOne.mockResolvedValue({ id: 'MLA1', variations });
    apiService.put.mockResolvedValue({ ok: true });

    await service.updateClassic('user', 'MLA1', {
      variationId: 181000000001,
      quantity: 5,
    });

    expect(apiService.put).toHaveBeenCalledTimes(1);
    expect(apiService.put).toHaveBeenCalledWith(
      '/items/MLA1',
      {
        variations: [
          { id: 181000000001, available_quantity: 5 },
          { id: 181000000002 },
          { id: 181000000003 },
          { id: 181000000004 },
        ],
      },
      'token',
    );

    expect(variations.map((variation) => variation.available_quantity)).toEqual(
      [3, 7, 11, 13],
    );
  });

  it('devuelve 400 y no actualiza cuando la variación no existe', async () => {
    itemsService.getOne.mockResolvedValue({
      id: 'MLA1',
      variations: [{ id: 1 }, { id: 2 }],
    });

    const update = service.updateClassic('user', 'MLA1', {
      variationId: 99,
      quantity: 5,
    });

    await expect(update).rejects.toMatchObject({
      message: 'La variación indicada no existe en la publicación',
    });
    await expect(update).rejects.toBeInstanceOf(BadRequestException);
    await expect(update).rejects.toHaveProperty('status', 400);
    expect(apiService.put).not.toHaveBeenCalled();
  });

  it('usa available_quantity cuando la publicación no tiene variaciones', async () => {
    itemsService.getOne.mockResolvedValue({ id: 'MLA1', variations: [] });
    apiService.put.mockResolvedValue({ ok: true });

    await service.updateClassic('user', 'MLA1', { quantity: 17 });

    expect(apiService.put).toHaveBeenCalledWith(
      '/items/MLA1',
      { available_quantity: 17 },
      'token',
    );
  });
});
