import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';
import { SimilarPublicationController } from './similar-publication.controller';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
} as SafeUser;

describe('SimilarPublicationController', () => {
  it('expone la subida Base64 protegida y conserva la respuesta de pictures', async () => {
    const base64UploadService = {
      upload: jest.fn().mockResolvedValue({
        id: 'NEW-PICTURE',
        secureUrl: 'https://http2.mlstatic.com/new-picture.jpg',
      }),
    };
    const controller = new SimilarPublicationController(
      {} as never,
      {} as never,
      {} as never,
      base64UploadService as never,
    );
    const input = {
      fileName: 'foto.png',
      mimeType: 'image/png',
      base64: 'AQID',
    };

    await expect(controller.uploadBase64Picture(USER, input)).resolves.toEqual({
      id: 'NEW-PICTURE',
      secureUrl: 'https://http2.mlstatic.com/new-picture.jpg',
    });
    expect(base64UploadService.upload).toHaveBeenCalledWith(USER.id, input);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SimilarPublicationController),
    ).toContain(AccessTokenGuard);
    const handler = Object.getOwnPropertyDescriptor(
      SimilarPublicationController.prototype,
      'uploadBase64Picture',
    )?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('pictures/base64');
  });
});
