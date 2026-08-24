import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { ItemsService } from '../items/items.service';
import { DescriptionService } from './description.service';

type ApiMock = jest.Mocked<Pick<MercadolibreApiService, 'get'>>;

describe('DescriptionService.getPlainTextByItemId', () => {
  let apiService: ApiMock;
  let service: DescriptionService;

  beforeEach(() => {
    apiService = { get: jest.fn() };
    service = new DescriptionService(
      {} as MercadolibreTokenService,
      apiService as unknown as MercadolibreApiService,
      {} as ItemsService,
    );
  });

  it('usa el GET central y normaliza espacios y saltos de línea', async () => {
    apiService.get.mockResolvedValue({
      text: '<script>no usar</script>',
      plain_text: '  Línea uno\r\nLínea dos\rLínea tres  ',
    });

    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).resolves.toBe('Línea uno\nLínea dos\nLínea tres');
    expect(apiService.get).toHaveBeenCalledWith(
      '/items/MLA123/description',
      'private-token',
      'description',
    );
  });

  it('devuelve null solamente cuando la descripción no existe', async () => {
    apiService.get.mockRejectedValue(
      new NotFoundException(
        'Mercado Libre no encontró la descripción solicitada',
      ),
    );

    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).resolves.toBeNull();
  });

  it('rechaza un identificador inválido sin consultar Mercado Libre', async () => {
    await expect(
      service.getPlainTextByItemId('../oauth/token', 'private-token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(apiService.get).not.toHaveBeenCalled();
  });

  it('omite la descripción si falta plain_text y no usa text como fallback', async () => {
    apiService.get.mockResolvedValue({ text: '<b>contenido externo</b>' });

    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).resolves.toBeNull();
  });

  it('omite plain_text vacío y rechaza un tipo externo inválido', async () => {
    apiService.get
      .mockResolvedValueOnce({ plain_text: ' \r\n ' })
      .mockResolvedValueOnce({ plain_text: 123 });

    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).resolves.toBeNull();
    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('propaga errores distintos de un 404 de descripción', async () => {
    const upstreamError = new BadGatewayException(
      'Mercado Libre no completó la solicitud',
    );
    apiService.get.mockRejectedValue(upstreamError);

    await expect(
      service.getPlainTextByItemId('MLA123', 'private-token'),
    ).rejects.toBe(upstreamError);
  });
});
