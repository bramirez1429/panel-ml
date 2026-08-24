import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { isJsonObject } from '../../shared/mercadolibre.types';

import { ItemsService } from '../items/items.service';
import { PublicationsMapper } from '../publications/publications.mapper';

import type { DescriptionUpdate, MlDescription } from './description.types';

@Injectable()
export class DescriptionService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly itemsService: ItemsService,
  ) {}

  async getClassic(userId: string, itemId: string): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.getDescription(item.id, accessToken);
  }

  async createClassic(
    userId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.createDescription(item.id, changes, accessToken);
  }

  async updateClassic(
    userId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    if (PublicationsMapper.getModel(item) !== 'SHARED') {
      throw new BadRequestException('La publicación no es versión clásica');
    }

    return this.updateDescription(item.id, changes, accessToken);
  }

  async getNew(
    userId: string,
    familyId: string,
    itemId: string,
  ): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.getDescription(item.id, accessToken);
  }

  /** Lee la descripción real de un MLA sin convertir texto externo en HTML. */
  async getPlainTextByItemId(
    itemId: string,
    accessToken: string,
  ): Promise<string | null> {
    if (!/^MLA\d+$/.test(itemId)) {
      throw new BadRequestException('itemId debe comenzar con MLA');
    }

    try {
      const description = await this.getDescription(itemId, accessToken);
      if (!isJsonObject(description)) {
        throw new BadGatewayException(
          'Mercado Libre devolvió una descripción inválida',
        );
      }
      if (
        description.plain_text === undefined ||
        description.plain_text === null
      ) {
        return null;
      }
      if (typeof description.plain_text !== 'string') {
        throw new BadGatewayException(
          'Mercado Libre devolvió una descripción inválida',
        );
      }

      return normalizePlainText(description.plain_text);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  async createNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.createDescription(item.id, changes, accessToken);
  }

  async updateNew(
    userId: string,
    familyId: string,
    itemId: string,
    changes: DescriptionUpdate,
  ): Promise<MlDescription> {
    const accessToken = await this.tokenService.getValidAccessToken(userId);

    const item = await this.itemsService.getOne(itemId, accessToken);

    this.validateNewItem(
      familyId,
      item.family_id,
      PublicationsMapper.getModel(item),
    );

    return this.updateDescription(item.id, changes, accessToken);
  }

  private getDescription(
    itemId: string,
    accessToken: string,
  ): Promise<MlDescription> {
    return this.apiService.get<MlDescription>(
      `/items/${encodeURIComponent(itemId)}/description`,
      accessToken,
      'description',
    );
  }

  private createDescription(
    itemId: string,
    changes: DescriptionUpdate,
    accessToken: string,
  ): Promise<MlDescription> {
    const plainText = this.validatePlainText(changes.plainText);

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
    const plainText = this.validatePlainText(changes.plainText);

    return this.apiService.put<MlDescription>(
      `/items/${itemId}/description?api_version=2`,
      {
        plain_text: plainText,
      },
      accessToken,
    );
  }

  private validatePlainText(plainText: string): string {
    if (typeof plainText !== 'string' || !plainText.trim()) {
      throw new BadRequestException('La descripción no puede estar vacía');
    }

    return plainText.trim();
  }

  private validateNewItem(
    familyId: string,
    itemFamilyId: string | number | null | undefined,
    model: string,
  ): void {
    if (model !== 'VARIANT_PRICING') {
      throw new BadRequestException('La publicación no es versión nueva');
    }

    if (String(itemFamilyId ?? '') !== familyId) {
      throw new BadRequestException(
        'El MLA no pertenece a la familia indicada',
      );
    }
  }
}

/** Normaliza el formato de texto sin interpretar contenido externo como HTML. */
function normalizePlainText(value: string): string | null {
  return value.replaceAll(/\r\n?/g, '\n').trim() || null;
}
