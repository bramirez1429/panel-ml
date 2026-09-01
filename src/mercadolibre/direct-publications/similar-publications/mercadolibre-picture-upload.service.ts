import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';
import type {
  SimilarPublicationPictureUpload,
  SimilarPublicationUploadFile,
} from './similar-publication.types';

const MAX_PICTURE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

@Injectable()
export class MercadoLibrePictureUploadService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
  ) {}

  async upload(
    userId: string,
    file: SimilarPublicationUploadFile | undefined,
  ): Promise<SimilarPublicationPictureUpload> {
    validateFile(file);
    const accessToken = await this.tokenService.getValidAccessToken(userId);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    const response = await this.apiService.postMultipart<unknown>(
      '/pictures/items/upload',
      form,
      accessToken,
    );
    if (!isJsonObject(response) || !text(response.id)) {
      throw new BadGatewayException(
        'Mercado Libre devolvió una imagen inválida',
      );
    }
    const secureUrl = Array.isArray(response.variations)
      ? response.variations.flatMap((variation) =>
          isJsonObject(variation) && text(variation.secure_url)
            ? [text(variation.secure_url) as string]
            : [],
        )[0]
      : undefined;
    if (!secureUrl) {
      throw new BadGatewayException(
        'Mercado Libre no informó la URL de la imagen',
      );
    }
    return { id: text(response.id) as string, secureUrl };
  }
}

function validateFile(
  file: SimilarPublicationUploadFile | undefined,
): asserts file is SimilarPublicationUploadFile {
  if (!file) throw new BadRequestException('El archivo es obligatorio');
  const extension = file.originalname.split('.').pop()?.toLocaleLowerCase();
  if (
    !ALLOWED_MIME_TYPES.has(file.mimetype.toLocaleLowerCase()) ||
    !extension ||
    !ALLOWED_EXTENSIONS.has(extension)
  ) {
    throw new BadRequestException('La imagen debe ser JPG, JPEG o PNG');
  }
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > MAX_PICTURE_SIZE
  ) {
    throw new BadRequestException('La imagen debe pesar como máximo 10 MB');
  }
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length !== file.size) {
    throw new BadRequestException('El archivo recibido es inválido');
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
