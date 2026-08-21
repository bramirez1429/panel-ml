import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { EditablePictureInput, PicturesUpdate } from './pictures.types';

@Injectable()
export class PicturesService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  /** Consulta imágenes de publicación clásica. */
  async getClassicPictures(itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return {
      model: 'SHARED',
      itemId: item.id,

      pictures:
        item.pictures?.map((picture) => ({
          id: picture.id,
          url: picture.secure_url ?? picture.url ?? null,
        })) ?? [],
    };
  }

  /** Reemplaza/reordena imágenes de publicación clásica. */
  async updateClassicPictures(itemId: string, changes: PicturesUpdate) {
    const pictures = this.validatePictures(changes.pictures);

    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.apiService.put(
      `/items/${item.id}`,
      {
        pictures,
      },
      accessToken,
    );
  }

  /** Consulta imágenes de un User Product nuevo. */
  async getNewPictures(familyId: string, itemId: string) {
    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    this.validateFamily(familyId, item.family_id);

    const userProductId = item.user_product_id;

    if (!userProductId) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }

    const userProduct = await this.apiService.get<{
      id: string;
      pictures?: Array<{
        id?: string;
        url?: string;
        secure_url?: string;
      }>;
    }>(`/user-products/${userProductId}`, accessToken);

    return {
      model: 'VARIANT_PRICING',
      familyId,
      itemId: item.id,
      userProductId,

      pictures:
        userProduct.pictures?.map((picture) => ({
          id: picture.id ?? null,
          url: picture.secure_url ?? picture.url ?? null,
        })) ?? [],
    };
  }

  /** Reemplaza/reordena imágenes de un User Product nuevo. */
  async updateNewPictures(
    familyId: string,
    itemId: string,
    changes: PicturesUpdate,
  ) {
    const pictures = this.validatePictures(changes.pictures);

    const accessToken = await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    this.validateFamily(familyId, item.family_id);

    if (!item.user_product_id) {
      throw new BadRequestException('La publicación no tiene userProductId');
    }

    return this.apiService.put(
      `/items/${item.id}`,
      {
        pictures,
      },
      accessToken,
    );
  }

  private validatePictures(
    pictures: EditablePictureInput[],
  ): EditablePictureInput[] {
    if (!Array.isArray(pictures) || pictures.length === 0) {
      throw new BadRequestException('Debes enviar al menos una imagen');
    }

    return pictures.map((picture, index) => {
      if (!picture || typeof picture !== 'object') {
        throw new BadRequestException(`Imagen ${index + 1} inválida`);
      }

      const id = typeof picture.id === 'string' ? picture.id.trim() : '';

      const source =
        typeof picture.source === 'string' ? picture.source.trim() : '';

      if (!id && !source) {
        throw new BadRequestException(
          `Imagen ${index + 1}: debes enviar id o source`,
        );
      }

      if (id) {
        return {
          id,
        };
      }

      return {
        source,
      };
    });
  }

  private validateFamily(
    familyId: string,
    itemFamilyId: string | number | null | undefined,
  ): void {
    if (String(itemFamilyId ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }
  }
}
