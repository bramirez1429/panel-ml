import { BadRequestException, Injectable } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject, isNonEmptyString } from '../../shared/mercadolibre.types';
import { PublicationActivityService } from '../activity/publication-activity.service';
import { PublicationSyncService } from '../sync/publication-sync.service';
import {
  PublicationPictureUploadService,
  UploadedPictureContext,
} from './publication-picture-upload.service';
import {
  PublicationManagementContext,
  PublicationManagementTargetService,
} from './publication-management-target.service';
import {
  ManagedPicture,
  parseLivePictures,
  parseLiveVariations,
  UploadedPictureFile,
} from './publication-management.types';
import {
  picturesAuditValue,
  runAuditedPublicationMutation,
} from './publication-mutation-audit.helpers';
import { PublicationSnapshotService } from './publication-snapshot.service';
import {
  mutationItemResponse,
  mutationSyncAccess,
} from './publication-mutation-response';
import {
  normalizePictureReorderBody,
  parsePictureMutation,
  parsePictureReorder,
  parsePictureReplace,
  PictureSelector,
  validatePictureVariation,
} from './publication-pictures.helpers';
import {
  createPictureAddPayload,
  createPictureRemovePayload,
  createPictureReorderPayload,
  createPictureReplacePayload,
} from './publication-picture-payloads';

@Injectable()
export class PublicationPicturesService {
  constructor(
    private readonly targets: PublicationManagementTargetService,
    private readonly apiService: MercadolibreApiService,
    private readonly snapshots: PublicationSnapshotService,
    private readonly sync: PublicationSyncService,
    private readonly activity: PublicationActivityService,
    private readonly uploader: PublicationPictureUploadService,
  ) {}

  /** Despacha el contrato multipart unico de administracion de imagenes. */
  async update(
    productId: string,
    body: unknown,
    file: UploadedPictureFile | undefined,
  ) {
    if (!isJsonObject(body) || !isNonEmptyString(body.operation)) {
      throw new BadRequestException('operation es obligatorio');
    }
    switch (body.operation) {
      case 'upload': {
        const uploaded = await this.uploader.upload(productId, body, file);
        return this.addKnown(productId, uploaded);
      }
      case 'replace': {
        const current = parsePictureMutation(body);
        const uploaded = await this.uploader.upload(productId, body, file);
        return this.replaceKnown(productId, current.pictureId, uploaded);
      }
      case 'remove':
        return this.remove(productId, body);
      case 'reorder':
        return this.reorder(productId, normalizePictureReorderBody(body));
      default:
        throw new BadRequestException(
          'operation debe ser upload, remove, replace o reorder',
        );
    }
  }

  /** Agrega una imagen ya subida sin modificar otras referencias. */
  async add(productId: string, body: unknown) {
    const input = parsePictureMutation(body);
    return this.mutate(
      productId,
      input,
      { operation: 'add', ...input },
      (pictures, variations) =>
        createPictureAddPayload(pictures, variations, input),
    );
  }

  /** Elimina una imagen solo si la galeria y variantes siguen siendo validas. */
  async remove(productId: string, body: unknown) {
    const input = parsePictureMutation(body);
    return this.mutate(
      productId,
      input,
      { operation: 'remove', ...input },
      (pictures, variations) =>
        createPictureRemovePayload(pictures, variations, input),
    );
  }

  /** Reemplaza una imagen preservando las referencias de cada variante. */
  async replace(productId: string, body: unknown) {
    const input = parsePictureReplace(body);
    return this.mutate(
      productId,
      input,
      { operation: 'replace', ...input },
      (pictures, variations) =>
        createPictureReplacePayload(pictures, variations, input),
    );
  }

  /** Reordena la galeria sin agregar ni quitar IDs. */
  async reorder(productId: string, body: unknown) {
    const input = parsePictureReorder(body);
    return this.mutate(
      productId,
      input,
      { operation: 'reorder', ...input },
      (pictures, variations) =>
        createPictureReorderPayload(pictures, variations, input.pictureIds),
    );
  }

  private async mutate(
    productId: string,
    input: PictureSelector,
    newValue: unknown,
    createPayload: (
      pictures: ManagedPicture[],
      variations: ReturnType<typeof parseLiveVariations>,
    ) => Record<string, unknown>,
  ) {
    const context = await this.targets.resolve(productId, input.itemId);
    return this.mutateKnown(
      productId,
      context,
      null,
      input,
      newValue,
      createPayload,
    );
  }

  private async addKnown(
    productId: string,
    uploaded: UploadedPictureContext,
  ) {
    const input = { ...uploaded.input, pictureId: uploaded.pictureId };
    return this.mutateKnown(
      productId,
      uploaded.context,
      uploaded.live,
      input,
      { operation: 'add', ...input },
      (pictures, variations) =>
        createPictureAddPayload(pictures, variations, input),
    );
  }

  private async replaceKnown(
    productId: string,
    pictureId: string,
    uploaded: UploadedPictureContext,
  ) {
    const input = {
      ...uploaded.input,
      pictureId,
      replacementPictureId: uploaded.pictureId,
    };
    return this.mutateKnown(
      productId,
      uploaded.context,
      uploaded.live,
      input,
      { operation: 'replace', ...input },
      (pictures, variations) =>
        createPictureReplacePayload(pictures, variations, input),
    );
  }

  private async mutateKnown(
    productId: string,
    context: PublicationManagementContext,
    knownLive: Record<string, unknown> | null,
    input: PictureSelector,
    newValue: unknown,
    createPayload: (
      pictures: ManagedPicture[],
      variations: ReturnType<typeof parseLiveVariations>,
    ) => Record<string, unknown>,
  ) {
    const audit = {
      sellerId: context.sellerId,
      productId,
      itemId: context.target.itemId,
      action: 'PICTURES_UPDATED' as const,
      oldValue: null as unknown,
      newValue,
    };

    return runAuditedPublicationMutation(this.activity, audit, async () => {
      const live = knownLive ?? (await this.targets.getOwnedItem(context));
      audit.oldValue = picturesAuditValue(live);
      const pictures = parseLivePictures(live.pictures);
      const variations = parseLiveVariations(live.variations);
      validatePictureVariation(
        context.target.model,
        variations,
        input.variationId,
      );
      const update = createPayload(pictures, variations);
      audit.newValue = picturesAuditValue(update);
      const response = await this.apiService.put<unknown>(
        `/items/${encodeURIComponent(context.target.itemId)}`,
        update,
        context.accessToken,
        'picturesMutation',
      );
      const refreshed = mutationItemResponse(response, context);
      await this.sync.syncKnownItem(refreshed, mutationSyncAccess(context));
      const snapshot = await this.snapshots.persist(context.target, refreshed);
      return { ok: true as const, productId, ...snapshot };
    });
  }
}
