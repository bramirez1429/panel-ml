import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject, isNonEmptyString } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { recordPublicationMutationFailure } from './publication-mutation-audit.helpers';
import {
  PublicationManagementContext,
  PublicationManagementTargetService,
} from './publication-management-target.service';
import {
  parseLiveVariations,
  UploadedPictureFile,
} from './publication-management.types';
import {
  parsePictureSelector,
  PictureSelector,
  validatePictureVariation,
} from './publication-pictures.helpers';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export type UploadedPictureContext = {
  context: PublicationManagementContext;
  input: PictureSelector;
  live: Record<string, unknown>;
  pictureId: string;
};

@Injectable()
export class PublicationPictureUploadService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly activity: PublicationActivityService,
  ) {}

  /** Sube una imagen despues de validar el MLA y devuelve su contexto vivo. */
  async upload(
    productId: string,
    body: unknown,
    file: UploadedPictureFile | undefined,
  ): Promise<UploadedPictureContext> {
    validateImage(file);
    const input = parsePictureSelector(body);
    const context = await this.targets.resolve(productId, input.itemId);
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'PICTURES_UPDATED' as const,
      oldValue: null,
      newValue: { operation: 'upload', fileName: file.originalname },
    };
    try {
      const live = await this.targets.getOwnedItem(context);
      validatePictureVariation(
        context.target.model,
        parseLiveVariations(live.variations),
        input.variationId,
      );
      const form = new FormData();
      form.set(
        'file',
        new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
        file.originalname,
      );
      const response = await this.apiService.postMultipart<unknown>(
        '/pictures/items/upload',
        form,
        context.accessToken,
        'picturesMutation',
      );
      if (!isJsonObject(response) || !isNonEmptyString(response.id)) {
        throw new BadGatewayException('Mercado Libre no devolvio el picture_id');
      }
      return { context, input, live, pictureId: response.id.trim() };
    } catch (error) {
      await recordPublicationMutationFailure(this.activity, audit, error);
      throw error;
    }
  }
}

function validateImage(
  file: UploadedPictureFile | undefined,
): asserts file is UploadedPictureFile {
  if (!file) throw new BadRequestException('file es obligatorio');
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    throw new BadRequestException('file admite hasta 10 MB');
  }
  const jpeg =
    file.buffer.length >= 3 &&
    file.buffer[0] === 0xff &&
    file.buffer[1] === 0xd8 &&
    file.buffer[2] === 0xff;
  const png =
    file.buffer.length >= 8 &&
    file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (
    (!jpeg && !png) ||
    (jpeg && !['image/jpeg', 'image/jpg'].includes(file.mimetype)) ||
    (png && file.mimetype !== 'image/png')
  ) {
    throw new BadRequestException('file debe ser JPEG o PNG valido');
  }
}
