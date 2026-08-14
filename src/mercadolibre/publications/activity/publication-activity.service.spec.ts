import { BadRequestException } from '@nestjs/common';
import { MercadolibrePublicationActionsRepository } from '../../../database/repositories/mercadolibre-publication-actions.repository';
import { PublicationManagementTargetService } from '../mutations/publication-management-target.service';
import { PublicationActivityService } from './publication-activity.service';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';

describe('PublicationActivityService', () => {
  const findRecent = jest.fn();
  const resolveProduct = jest.fn();
  const resolve = jest.fn();
  let service: PublicationActivityService;

  beforeEach(() => {
    jest.resetAllMocks();
    findRecent.mockResolvedValue([]);
    resolveProduct.mockResolvedValue({ sellerId: 123 });
    resolve.mockResolvedValue({ target: { itemId: 'MLA100' } });
    service = new PublicationActivityService(
      { findRecent } as unknown as MercadolibrePublicationActionsRepository,
      {
        resolveProduct,
        resolve,
      } as unknown as PublicationManagementTargetService,
    );
  });

  it('usa limite 20 por defecto y lo pasa al repository', async () => {
    await service.list(PRODUCT_ID, undefined);

    expect(findRecent).toHaveBeenCalledWith(123, PRODUCT_ID, null, 20);
  });

  it('acepta el query string y lo acota a un maximo de 100', async () => {
    await service.list(PRODUCT_ID, 'MLA100', '250');

    expect(resolve).toHaveBeenCalledWith(PRODUCT_ID, 'MLA100');
    expect(findRecent).toHaveBeenCalledWith(123, PRODUCT_ID, 'MLA100', 100);
  });

  it.each(['0', '-1', '1.5', 'texto', [], 2.5])(
    'rechaza un limite invalido: %p',
    async (limit) => {
      await expect(
        service.list(PRODUCT_ID, undefined, limit),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(resolveProduct).not.toHaveBeenCalled();
      expect(findRecent).not.toHaveBeenCalled();
    },
  );
});
