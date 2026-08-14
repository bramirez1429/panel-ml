import { BadRequestException } from '@nestjs/common';
import { MercadolibreApiService } from '../../shared/mercadolibre-api.service';
import { PublicationPublishingPlannerService } from './publication-publishing-planner.service';
import { PublishingPlan } from './publication-publishing.types';
import { PublicationValidationService } from './publication-validation.service';

const PLAN: PublishingPlan = {
  context: {
    sellerId: 42,
    accessToken: 'token',
    usesUserProducts: false,
    managesWarehouse: false,
  },
  model: 'LEGACY',
  items: [
    {
      description: null,
      payload: {
        category_id: 'MLA1234',
        title: 'Prueba',
        attributes: [{ id: 'BRAND', value_name: 'Acme' }],
      },
    },
  ],
};

describe('PublicationValidationService', () => {
  const plan = jest.fn();
  const post = jest.fn();
  const service = new PublicationValidationService(
    { plan } as unknown as PublicationPublishingPlannerService,
    { post } as unknown as MercadolibreApiService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    plan.mockResolvedValue(PLAN);
  });

  it('consulta atributos condicionales antes de /items/validate', async () => {
    post
      .mockResolvedValueOnce({
        required_attributes: [{ id: 'GTIN', name: 'Codigo universal' }],
      })
      .mockResolvedValueOnce(undefined);

    const result = await service.validate({});

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'item.attribute.missing_conditional_required',
        field: 'GTIN',
        itemIndex: 0,
      }),
    ]);
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/categories/MLA1234/attributes/conditional',
      PLAN.items[0].payload,
      'token',
      'validation',
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/items/validate',
      PLAN.items[0].payload,
      'token',
      'validation',
    );
  });

  it('convierte el 400 de ML en issues sin publicar', async () => {
    post.mockResolvedValueOnce({}).mockRejectedValueOnce(
      new BadRequestException({
        message: 'Atributo requerido',
        cause: [
          {
            code: 'item.attributes.missing_required',
            message: 'Falta BRAND',
            references: ['BRAND'],
          },
        ],
      }),
    );

    const result = await service.validate({});

    expect(result.valid).toBe(false);
    expect(result.issues[0]).toEqual({
      code: 'item.attributes.missing_required',
      field: 'BRAND',
      message: 'Falta BRAND',
      itemIndex: 0,
    });
  });
});
