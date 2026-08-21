import { BadRequestException, Injectable } from '@nestjs/common';

import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { FamiliesService } from '../families/families.service';
import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';

import type {
  FamilyTaskResponse,
  FamilyUpdateRequest,
  FamilyTaskStatusResponse,
} from './family-update.types';

@Injectable()
export class FamilyUpdateService {
  constructor(
    private readonly familiesService: FamiliesService,
    private readonly apiService: MercadolibreApiService,
    private readonly tokenService: MercadolibreTokenService,
  ) {}

  /**
   * Edita contenido compartido de una familia
   * VARIANT_PRICING.
   */
  async updateFamily(
    familyId: string,
    changes: {
      familyName?: string;
    },
  ): Promise<FamilyTaskResponse> {
    this.validateFamilyId(familyId);
    this.validateChanges(changes);

    const { family, accessToken } =
      await this.familiesService.getFamilyItems(familyId);

    if (changes.familyName !== undefined && !changes.familyName.trim()) {
      throw new BadRequestException(
        'El nombre de la familia no puede estar vacío',
      );
    }

    const userProductIds = family.user_products_ids ?? [];

    if (userProductIds.length === 0) {
      throw new BadRequestException('La familia no tiene User Products');
    }

    const body: FamilyUpdateRequest = {
      common_content: {
        ...(changes.familyName !== undefined
          ? {
              family_name: changes.familyName.trim(),
            }
          : {}),
      },

      user_products: userProductIds.map((userProductId) => ({
        id: userProductId,
      })),
    };

    return this.apiService.post<FamilyTaskResponse>(
      `/user-products-families/${familyId}/tasks`,
      body,
      accessToken,
    );
  }

  private validateFamilyId(familyId: string): void {
    if (!/^\d+$/.test(familyId)) {
      throw new BadRequestException('familyId inválido');
    }
  }

  private validateChanges(changes: object): void {
    if (
      !changes ||
      typeof changes !== 'object' ||
      Array.isArray(changes) ||
      Object.keys(changes).length === 0
    ) {
      throw new BadRequestException('No se enviaron cambios');
    }

    const allowedFields = new Set(['familyName']);

    const invalidFields = Object.keys(changes).filter(
      (field) => !allowedFields.has(field),
    );

    if (invalidFields.length > 0) {
      throw new BadRequestException({
        message: 'Se enviaron campos no permitidos',
        invalidFields,
      });
    }
  }

  async getTaskStatus(taskId: string): Promise<FamilyTaskStatusResponse> {
    if (!taskId.trim()) {
      throw new BadRequestException('taskId inválido');
    }

    const accessToken = await this.tokenService.getValidAccessToken();

    return this.apiService.get<FamilyTaskStatusResponse>(
      `/user-products-families/tasks/${encodeURIComponent(taskId)}`,
      accessToken,
    );
  }
}
