import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { MercadolibreTokenService } from '../../auth/mercadolibre-token.service';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';

import { ItemsService } from '../items/items.service';
import { PublicationsSearchService } from '../publications/publications-search.service';
import { FamiliesMapper } from './families.mapper';

import { MlItem } from '../items/items.types';
import { MlFamilyResponse } from './families-ml.types';

@Injectable()
export class FamiliesService {
  constructor(
    private readonly tokenService: MercadolibreTokenService,
    private readonly apiService: MercadolibreApiService,
    private readonly searchService: PublicationsSearchService,
    private readonly itemsService: ItemsService,
  ) {}

  /** Devuelve una familia agrupada para el listado. */
  async getSummary(userId: string, familyId: string) {
    const { family, items } = await this.loadFamily(userId, familyId);

    return FamiliesMapper.toSummary(family, items);
  }

  /** Devuelve familia + todos sus MLA para otros servicios. */
  async getFamilyItems(userId: string, familyId: string) {
    return this.loadFamily(userId, familyId);
  }

  /** Resuelve family_id → MLAU → MLA. */
  private async loadFamily(
    userId: string,
    familyId: string,
  ): Promise<{
    family: MlFamilyResponse;
    items: MlItem[];
    itemIds: string[];
    accessToken: string;
  }> {
    this.validateFamilyId(familyId);

    const connection = await this.tokenService.getStoredConnection(userId);
    const accessToken = await this.tokenService.getValidAccessToken(
      userId,
      connection,
    );

    // 1. family_id → MLAU.
    const family = await this.apiService.get<MlFamilyResponse>(
      `/sites/MLA/user-products-families/${familyId}`,
      accessToken,
    );

    this.validateSeller(family, connection.seller_id);

    // 2. MLAU → MLA.
    const itemIds = await this.searchService.searchByUserProductIds(
      connection.seller_id,
      family.user_products_ids,
      accessToken,
    );

    // 3. Obtenemos todos los MLA completos.
    const items = await this.itemsService.getMany(itemIds, accessToken);

    return {
      family,
      items,
      itemIds,
      accessToken,
    };
  }

  private validateFamilyId(familyId: string): void {
    if (!/^\d+$/.test(familyId)) {
      throw new BadRequestException('familyId inválido');
    }
  }

  private validateSeller(
    family: MlFamilyResponse,
    sellerId: string | number,
  ): void {
    if (String(family.user_id) !== String(sellerId)) {
      throw new ForbiddenException(
        'La familia no pertenece al seller conectado',
      );
    }
  }
}
