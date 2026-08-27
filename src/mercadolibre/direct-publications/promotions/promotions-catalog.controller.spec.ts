import { GUARDS_METADATA } from '@nestjs/common/constants';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';

import { PromotionsCatalogController } from './promotions-catalog.controller';
import type { PromotionsCatalogService } from './promotions-catalog.service';

const USER: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PromotionsCatalogController', () => {
  it('protege el catálogo y propaga el usuario autenticado', async () => {
    const service = {
      getCatalog: jest.fn().mockResolvedValue({ publications: [] }),
    };
    const controller = new PromotionsCatalogController(
      service as unknown as PromotionsCatalogService,
    );

    await controller.getCatalog(USER, { limit: 20 });

    expect(service.getCatalog).toHaveBeenCalledWith(USER.id, { limit: 20 });
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PromotionsCatalogController),
    ).toContain(AccessTokenGuard);
  });
});
