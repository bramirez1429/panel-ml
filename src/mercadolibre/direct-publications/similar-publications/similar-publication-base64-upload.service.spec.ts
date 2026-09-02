import { SimilarPublicationBase64UploadService } from './similar-publication-base64-upload.service';

describe('SimilarPublicationBase64UploadService', () => {
  it.each([
    ['foto.png', 'image/png'],
    ['foto.jpg', 'image/jpeg'],
  ])(
    'convierte una imagen %s y delega la subida',
    async (fileName, mimeType) => {
      const bytes = Buffer.from([1, 2, 3, 4]);
      const pictureUploadService = {
        upload: jest.fn().mockResolvedValue({
          id: 'NEW-PICTURE',
          secureUrl: 'https://http2.mlstatic.com/new-picture.jpg',
        }),
      };
      const service = new SimilarPublicationBase64UploadService(
        pictureUploadService as never,
      );

      await expect(
        service.upload('user-id', {
          fileName,
          mimeType,
          base64: bytes.toString('base64'),
        }),
      ).resolves.toEqual({
        id: 'NEW-PICTURE',
        secureUrl: 'https://http2.mlstatic.com/new-picture.jpg',
      });
      expect(pictureUploadService.upload).toHaveBeenCalledWith('user-id', {
        originalname: fileName,
        mimetype: mimeType,
        size: bytes.length,
        buffer: bytes,
      });
    },
  );

  it('rechaza MIME no permitido sin delegar', async () => {
    const pictureUploadService = { upload: jest.fn() };
    const service = new SimilarPublicationBase64UploadService(
      pictureUploadService as never,
    );

    await expect(
      service.upload('user-id', {
        fileName: 'foto.webp',
        mimeType: 'image/webp',
        base64: Buffer.from([1]).toString('base64'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(pictureUploadService.upload).not.toHaveBeenCalled();
  });

  it.each([[''], ['%%%'], ['a']])(
    'rechaza Base64 vacío o inválido',
    async (base64) => {
      const service = new SimilarPublicationBase64UploadService({
        upload: jest.fn(),
      } as never);

      await expect(
        service.upload('user-id', {
          fileName: 'foto.png',
          mimeType: 'image/png',
          base64,
        }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('rechaza una imagen original mayor a 3 MB', async () => {
    const pictureUploadService = { upload: jest.fn() };
    const service = new SimilarPublicationBase64UploadService(
      pictureUploadService as never,
    );

    await expect(
      service.upload('user-id', {
        fileName: 'foto.png',
        mimeType: 'image/png',
        base64: Buffer.alloc(3 * 1024 * 1024 + 1, 1).toString('base64'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(pictureUploadService.upload).not.toHaveBeenCalled();
  });
});
