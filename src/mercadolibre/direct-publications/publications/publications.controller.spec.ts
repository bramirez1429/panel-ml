import type { SafeUser } from '../../../auth/domain/auth.models';
import type { PublicationDetailService } from './publication-detail.service';
import type { PublicationSearchService } from './publication-search.service';
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
      {} as PublicationSearchService,
    );

    void controller.getGrouped(USER, '20', 'title-search:20', 'algodon nena');

    expect(service.getGrouped).toHaveBeenCalledWith(
      USER.id,
      20,
      'title-search:20',
      'algodon nena',
    );
  });

  it('delega la búsqueda reusable con query y paginación', () => {
    const searchService = {
      search: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new PublicationsController(
      {} as PublicationsService,
      {} as PublicationDetailService,
      searchService as unknown as PublicationSearchService,
    );

    void controller.search(USER, 'remera mujer', '10', 'title-search:10');

    expect(searchService.search).toHaveBeenCalledWith(
      USER.id,
      'remera mujer',
      10,
      'title-search:10',
    );
  });
});
