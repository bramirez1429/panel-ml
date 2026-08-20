import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type {
  DescriptionUpdate,
  MlDescription,
} from './description.types';

@Injectable()
export class DescriptionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  async getClassic(
    itemId: string,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    if (
      PublicationsMapper.getModel(item) !== 'SHARED'
    ) {
      throw new BadRequestException(
        'La publicación no es versión clásica',
      );
    }

    return this.getDescription(
      item.id,
      accessToken,
    );
  }

  async createClassic(
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    if (
      PublicationsMapper.getModel(item) !== 'SHARED'
    ) {
      throw new BadRequestException(
        'La publicación no es versión clásica',
      );
    }

    return this.createDescription(
      item.id,
      changes,
      accessToken,
    );
  }

  async updateClassic(
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    if (
      PublicationsMapper.getModel(item) !== 'SHARED'
    ) {
      throw new BadRequestException(
        'La publicación no es versión clásica',
      );
    }

    return this.updateDescription(
      item.id,
      changes,
      accessToken,
    );
  }

  async getNew(
    familyId: string,
    itemId: string,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.getDescription(
      item.id,
      accessToken,
    );
  }

  async createNew(
    familyId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.createDescription(
      item.id,
      changes,
      accessToken,
    );
  }

  async updateNew(
    familyId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken =
      await this.tokenService.getValidAccessToken();

    const item = await this.itemsService.getOne(
      itemId,
      accessToken,
    );

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.updateDescription(
      item.id,
      changes,
      accessToken,
    );
  }

  private getDescription(
    itemId: string,
    accessToken: string,
  ): Promise<MlDescription> {
    return this.apiService.get<MlDescription>(
      `/items/${itemId}/description`,
      accessToken,
    );
  }

  private createDescription(
    itemId: string,
    changes: DescriptionUpdate,
    accessToken: string,
  ): Promise<MlDescription> {
    const plainText =
      this.validatePlainText(changes.plainText);

    return this.apiService.post<MlDescription>(
      `/items/${itemId}/description`,
      {
        plain_text: plainText,
      },
      accessToken,
    );
  }

  private updateDescription(
    itemId: string,
    changes: DescriptionUpdate,
    accessToken: string,
  ): Promise<MlDescription> {
    const plainText =
      this.validatePlainText(changes.plainText);

    return this.apiService.put<MlDescription>(
      `/items/${itemId}/description?api_version=2`,
      {
        plain_text: plainText,
      },
      accessToken,
    );
  }

  private validatePlainText(
    plainText: string,
  ): string {
    if (
      typeof plainText !== 'string' ||
      !plainText.trim()
    ) {
      throw new BadRequestException(
        'La descripción no puede estar vacía',
      );
    }

    return plainText.trim();
  }

  private validateNewItem(
    familyId: string,
    itemFamilyId:
      | string
      | number
      | null
      | undefined,
    model: string,
  ): void {
    if (model !== 'VARIANT_PRICING') {
      throw new BadRequestException(
        'La publicación no es versión nueva',
      );
    }

    if (
      String(itemFamilyId ?? '') !== familyId
    ) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }
  }
}