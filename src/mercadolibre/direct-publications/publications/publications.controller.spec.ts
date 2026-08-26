import type { SafeUser } from '../../../auth/domain/auth.models';
import type { PublicationDetailService } from './publication-detail.service';
import { PublicationsController } from './publications.controller';
import type { PublicationsService } from './publications.service';

const USER: SafeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  name: 'User',
  isActive: true,
  createdAt: new Date('2030-01-01T00:00:00.000Z'),
  updatedAt: new Date('2030-01-01T00:00:00.000Z'),
};

describe('PublicationsController', () => {
  it('acepta search y lo conserva junto al cursor', () => {
    const service = {
      getGrouped: jest.fn().mockResolvedValue({ products: [] }),
    };
    const controller = new PublicationsController(
      service as unknown as PublicationsService,
      {} as PublicationDetailService,
    );

    void controller.getGrouped(USER, '20', 'title-search:20', 'algodon nena');

    expect(service.getGrouped).toHaveBeenCalledWith(
      USER.id,
      20,
      'title-search:20',
      'algodon nena',
    );
  });
});
