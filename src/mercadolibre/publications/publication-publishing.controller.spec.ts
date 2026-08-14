import { PublicationPublishingController } from './publication-publishing.controller';
import { PublicationCategoriesService } from './publishing/publication-categories.service';
import { PublicationPublishingService } from './publishing/publication-publishing.service';
import { PublicationValidationService } from './publishing/publication-validation.service';

describe('PublicationPublishingController', () => {
  const search = jest.fn();
  const getSchema = jest.fn();
  const validate = jest.fn();
  const publish = jest.fn();
  let controller: PublicationPublishingController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new PublicationPublishingController(
      { search, getSchema } as unknown as PublicationCategoriesService,
      { validate } as unknown as PublicationValidationService,
      { publish } as unknown as PublicationPublishingService,
    );
  });

  it('delega categorías y esquema sin alterar parámetros', async () => {
    await controller.searchCategories('notebook');
    await controller.getCategoryAttributes('MLA1652');

    expect(search).toHaveBeenCalledWith('notebook');
    expect(getSchema).toHaveBeenCalledWith('MLA1652');
  });

  it('delega validación y publicación con el mismo formulario', async () => {
    const body = { title: 'Notebook', categoryId: 'MLA1652' };

    await controller.validatePublication(body);
    await controller.publish(body);

    expect(validate).toHaveBeenCalledWith(body);
    expect(publish).toHaveBeenCalledWith(body);
  });
});
