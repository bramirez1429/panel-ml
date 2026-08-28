import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import type { SafeUser } from '../../../auth/domain/auth.models';
import { AccessTokenGuard } from '../../../auth/presentation/access-token.guard';

import { PromotionsCatalogController } from './promotions-catalog.controller';
import type { PromotionsCampaignsService } from './promotions-campaigns.service';
import type { PromotionsCatalogService } from './promotions-catalog.service';
import type { PromotionOptionsService } from './promotion-options.service';
import type { PromotionRemovalService } from './promotion-removal.service';
import type { PromotionSelectionService } from './promotion-selection.service';
import type { PublicationPromotionService } from './publication-promotion.service';

const USER: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('PromotionsCatalogController', () => {
  it('propaga usuario e item al diagnostico read-only', async () => {
    const campaigns = {
      getPromotionDiagnostic: jest.fn().mockResolvedValue({
        itemId: 'MLA3842290960',
        promotions: [],
      }),
    };
    const controller = new PromotionsCatalogController(
      {} as PromotionsCatalogService,
      campaigns as unknown as PromotionsCampaignsService,
      {} as PromotionOptionsService,
      {} as PromotionRemovalService,
      {} as PromotionSelectionService,
      {} as PublicationPromotionService,
    );

    await expect(
      controller.getPromotionDiagnostic(USER, 'MLA3842290960'),
    ).resolves.toEqual({ itemId: 'MLA3842290960', promotions: [] });
    expect(campaigns.getPromotionDiagnostic).toHaveBeenCalledWith(
      USER.id,
      'MLA3842290960',
    );
    const diagnosticHandler = Object.getOwnPropertyDescriptor(
      PromotionsCatalogController.prototype,
      'getPromotionDiagnostic',
    )?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, diagnosticHandler)).toBe(
      'diagnostico/:itemId',
    );
  });

  it('protege el catálogo y propaga el usuario autenticado', async () => {
    const service = {
      getCatalog: jest.fn().mockResolvedValue({ publications: [] }),
    };
    const options = { getOptions: jest.fn().mockResolvedValue([]) };
    const removal = {
      removeAll: jest.fn().mockResolvedValue({ success: true }),
    };
    const selection = { apply: jest.fn().mockResolvedValue({ success: true }) };
    const controller = new PromotionsCatalogController(
      service as unknown as PromotionsCatalogService,
      { getCampaigns: jest.fn() } as unknown as PromotionsCampaignsService,
      options as unknown as PromotionOptionsService,
      removal as unknown as PromotionRemovalService,
      selection as unknown as PromotionSelectionService,
      {} as PublicationPromotionService,
    );

    await controller.getCatalog(USER, { limit: 20 });

    expect(service.getCatalog).toHaveBeenCalledWith(USER.id, { limit: 20 });
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PromotionsCatalogController),
    ).toContain(AccessTokenGuard);
  });
});
