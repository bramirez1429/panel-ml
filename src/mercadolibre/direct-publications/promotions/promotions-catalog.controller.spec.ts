import { GUARDS_METADATA } from '@nestjs/common/constants';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';

import { PromotionsCatalogController } from './promotions-catalog.controller';
import type { PromotionsCatalogService } from './promotions-catalog.service';
import type { PromotionsFacetsService } from './promotions-facets.service';

const USER: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PromotionsCatalogController', () => {
  it('protege catálogo y facets con el usuario autenticado', async () => {
    const catalogService = {
      getCatalog: jest.fn().mockResolvedValue({ publications: [] }),
    };
    const facetsService = {
      getFacets: jest
        .fn()
        .mockResolvedValue({ categories: [], attributes: [] }),
    };
    const controller = new PromotionsCatalogController(
      catalogService as unknown as PromotionsCatalogService,
      facetsService as unknown as PromotionsFacetsService,
    );

    await controller.getCatalog(USER, { limit: 20 });
    await controller.getFacets(USER);

    expect(catalogService.getCatalog).toHaveBeenCalledWith(USER.id, {
      limit: 20,
    });
    expect(facetsService.getFacets).toHaveBeenCalledWith(USER.id);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PromotionsCatalogController),
    ).toContain(AccessTokenGuard);
  });
});
