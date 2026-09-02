import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadoLibrePictureUploadService } from './mercadolibre-picture-upload.service';
import type {
  SimilarPublicationPictureUpload,
  SimilarPublicationUploadFile,
} from './similar-publication.types';

const MAX_BASE64_PICTURE_SIZE = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

@Injectable()
export class SimilarPublicationBase64UploadService {
  constructor(
    private readonly pictureUploadService: MercadoLibrePictureUploadService,
  ) {}

  async upload(
    userId: string,
    input: unknown,
  ): Promise<SimilarPublicationPictureUpload> {
    const file = toUploadFile(input);
    return await this.pictureUploadService.upload(userId, file);
  }
}

function toUploadFile(input: unknown): SimilarPublicationUploadFile {
  if (!isObject(input)) {
    throw new BadRequestException('Los datos de la imagen son obligatorios');
  }

  const fileName = requiredText(input.fileName, 'fileName');
  const mimeType = requiredText(input.mimeType, 'mimeType').toLowerCase();
  const base64 = requiredText(input.base64, 'base64');

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException('La imagen debe ser JPG, JPEG o PNG');
  }

  const buffer = decodeBase64(base64);
  if (buffer.length > MAX_BASE64_PICTURE_SIZE) {
    throw new BadRequestException('La imagen debe pesar como máximo 3 MB');
  }

  return {
    originalname: fileName,
    mimetype: mimeType,
    size: buffer.length,
    buffer,
  };
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw invalidBase64();
  }

  const buffer = Buffer.from(value, 'base64');
  const canonical = buffer.toString('base64');
  if (
    buffer.length === 0 ||
    (value !== canonical && value !== canonical.replace(/=+$/, ''))
  ) {
    throw invalidBase64();
  }
  return buffer;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${field} es obligatorio`);
  }
  return value.trim();
}

function invalidBase64(): BadRequestException {
  return new BadRequestException('La imagen Base64 es inválida');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
