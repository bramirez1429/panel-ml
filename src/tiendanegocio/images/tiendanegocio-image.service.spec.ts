import { BadRequestException } from '@nestjs/common';
import type { TiendaNegocioApiService } from '../shared/tiendanegocio-api.service';
import { TiendaNegocioImageService } from './tiendanegocio-image.service';

describe('Imágenes Mercado Libre → Tienda Negocio', () => {
  const api = { post: jest.fn().mockResolvedValue({
    id: 11,
    src: 'https://cdn.v2.tiendanegocio.com/image/11.webp',
  }) };
  const service = new TiendaNegocioImageService(
    api as unknown as TiendaNegocioApiService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('no acepta orígenes arbitrarios (prevención SSRF)', async () => {
    await expect(
      service.uploadAll(1, ['https://evil.example.com/image.jpg'], 'token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadAll(1, ['http://http2.mlstatic.com/image.jpg'], 'token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadAll(1, ['https://mlstatic.com.evil.example.org/image.jpg'], 'token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rechaza identificadores inválidos y no hace POST', async () => {
    await expect(service.uploadAll(0, [], 'token'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('carga imágenes JPEG desde el CDN de ML como data URIs', async () => {
    const original = globalThis.fetch;
    const mock = jest.fn().mockResolvedValue(new Response(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      { status: 200, headers: { 'content-type': 'image/jpeg' } },
    ));
    globalThis.fetch = mock;
    try {
      const result = await service.uploadAll(
        123, ['https://http2.mlstatic.com/D_NQ_NP_123.jpg'], 'token',
      );
      expect(result).toEqual([{
        id: 11, src: 'https://cdn.v2.tiendanegocio.com/image/11.webp', position: 0,
      }]);
      expect(api.post).toHaveBeenCalledWith(
        '/products/123/images',
        { position: 0, file: 'data:image/jpeg;base64,/9j/2Q==' },
        'token',
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
