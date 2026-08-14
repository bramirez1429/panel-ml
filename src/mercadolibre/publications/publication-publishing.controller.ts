import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicationCategoriesService } from './publishing/publication-categories.service';
import { PublicationPublishingService } from './publishing/publication-publishing.service';
import { PublicationValidationService } from './publishing/publication-validation.service';

@Controller('mercadolibre/publicaciones')
export class PublicationPublishingController {
  /** Recibe consultas y comandos del flujo de creación de publicaciones. */
  constructor(
    private readonly categoriesService: PublicationCategoriesService,
    private readonly validationService: PublicationValidationService,
    private readonly publishingService: PublicationPublishingService,
  ) {}

  /** Busca categorías mediante el predictor oficial de Mercado Libre. */
  @Get('categories/search')
  searchCategories(@Query('q') query?: string) {
    return this.categoriesService.search(query);
  }

  /** Obtiene atributos y opciones vigentes de una categoría. */
  @Get('categories/:categoryId/attributes')
  getCategoryAttributes(@Param('categoryId') categoryId: string) {
    return this.categoriesService.getSchema(categoryId);
  }

  /** Valida atributos condicionales y cada item sin publicarlo. */
  @Post('validate')
  validatePublication(@Body() body: unknown) {
    return this.validationService.validate(body);
  }

  /** Publica en ML, sincroniza la nueva familia y devuelve el UUID interno. */
  @Post()
  publish(@Body() body: unknown) {
    return this.publishingService.publish(body);
  }
}
