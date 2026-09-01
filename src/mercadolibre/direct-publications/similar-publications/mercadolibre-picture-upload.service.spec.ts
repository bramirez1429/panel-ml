import { MercadoLibrePictureUploadService } from './mercadolibre-picture-upload.service';

describe('MercadoLibrePictureUploadService', () => {
  it('sube multipart al endpoint oficial y devuelve sólo id y secureUrl', async () => {
    const tokenService = {
      getValidAccessToken: jest.fn().mockResolvedValue('token'),
    };
    const apiService = {
      postMultipart: jest.fn().mockResolvedValue({
        id: 'NEW-PICTURE',
        variations: [
          { secure_url: 'https://http2.mlstatic.com/new-picture.jpg' },
        ],
      }),
    };
    const service = new MercadoLibrePictureUploadService(
      tokenService as never,
      apiService as never,
    );
    await expect(
      service.upload('user', {
        originalname: 'nueva.jpg',
        mimetype: 'image/jpeg',
        size: 3,
        buffer: Buffer.from([1, 2, 3]),
      }),
    ).resolves.toEqual({
      id: 'NEW-PICTURE',
      secureUrl: 'https://http2.mlstatic.com/new-picture.jpg',
    });
    expect(apiService.postMultipart).toHaveBeenCalledWith(
      '/pictures/items/upload',
      expect.any(FormData),
      'token',
    );
  });

  it.each([
    ['archivo.gif', 'image/gif', 3],
    ['archivo.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1],
  ])('rechaza formato o tamaño inválido', async (name, mimetype, size) => {
    const service = new MercadoLibrePictureUploadService(
      { getValidAccessToken: jest.fn() } as never,
      { postMultipart: jest.fn() } as never,
    );
    await expect(
      service.upload('user', {
        originalname: name,
        mimetype,
        size,
        buffer: Buffer.alloc(size),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
