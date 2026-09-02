import { HttpException } from '@nestjs/common';

import { SimilarPublicationDraftMapper } from './similar-publication.mapper';
import { SimilarPublicationSourceService } from './similar-publication-source.service';

describe('SimilarPublicationSourceService', () => {
  it('catálogo no soportado no lee descripción ni toca el original', async () => {
    const publicationSource = {
      getItemWithAllAttributes: jest.fn().mockResolvedValue({
        id: 'MLA123',
        seller_id: 10,
        catalog_product_id: 'CATALOG-1',
      }),
    };
    const description = { getPlainTextByItemId: jest.fn() };
    const apiService = { get: jest.fn(), post: jest.fn(), put: jest.fn() };
    const service = new SimilarPublicationSourceService(
      {
        getStoredConnection: jest.fn().mockResolvedValue({
          user_id: 'user',
          seller_id: 10,
        }),
        getValidAccessToken: jest.fn().mockResolvedValue('token'),
      } as never,
      publicationSource as never,
      {} as never,
      description as never,
      apiService as never,
      new SimilarPublicationDraftMapper(),
      { enrich: jest.fn() } as never,
    );
    let caught: unknown;
    try {
      await service.getDraft('user', 'item:MLA123');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const exception = caught as HttpException;
    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toMatchObject({
      errorCode: 'SIMILAR_PUBLICATION_CATALOG_NOT_SUPPORTED',
    });
    expect(description.getPlainTextByItemId).not.toHaveBeenCalled();
    expect(apiService.post).not.toHaveBeenCalled();
    expect(apiService.put).not.toHaveBeenCalled();
  });
});
