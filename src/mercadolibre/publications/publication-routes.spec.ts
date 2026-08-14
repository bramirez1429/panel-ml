import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { MercadolibreModule } from '../mercadolibre.module';
import { PublicationCommercialController } from './publication-commercial.controller';
import { PublicationMutationsController } from './publication-mutations.controller';
import { PublicationPublishingController } from './publication-publishing.controller';
import { PublicationsController } from './publications.controller';

interface ControllerClass {
  prototype: object;
}

const CONTROLLERS: ControllerClass[] = [
  PublicationsController,
  PublicationPublishingController,
  PublicationCommercialController,
  PublicationMutationsController,
];

const EXPECTED_ROUTES = [
  'DELETE /mercadolibre/publicaciones/:productId/promotions/price-discount',
  'GET /mercadolibre/publicaciones',
  'GET /mercadolibre/publicaciones/:productId/activity',
  'GET /mercadolibre/publicaciones/:productId/capabilities',
  'GET /mercadolibre/publicaciones/:productId/prices',
  'GET /mercadolibre/publicaciones/:productId/promotions',
  'GET /mercadolibre/publicaciones/categories/:categoryId/attributes',
  'GET /mercadolibre/publicaciones/categories/search',
  'GET /mercadolibre/publicaciones/detalle/:productId',
  'GET /mercadolibre/publicaciones/sync/:syncId',
  'PATCH /mercadolibre/publicaciones/:productId/attributes',
  'PATCH /mercadolibre/publicaciones/:productId/description',
  'PATCH /mercadolibre/publicaciones/:productId/precio',
  'PATCH /mercadolibre/publicaciones/:productId/sku',
  'PATCH /mercadolibre/publicaciones/:productId/status',
  'PATCH /mercadolibre/publicaciones/:productId/stock',
  'PATCH /mercadolibre/publicaciones/:productId/title',
  'POST /mercadolibre/publicaciones',
  'POST /mercadolibre/publicaciones/:productId/pictures',
  'POST /mercadolibre/publicaciones/:productId/promotions/price-discount',
  'POST /mercadolibre/publicaciones/sync',
  'POST /mercadolibre/publicaciones/sync/:syncId/next',
  'POST /mercadolibre/publicaciones/validate',
].sort();

// Obtiene las rutas HTTP declaradas en los controllers mediante metadata de Nest.
function getControllerRoutes(controller: ControllerClass): string[] {
  const baseMetadata: unknown = Reflect.getMetadata(PATH_METADATA, controller);
  const basePath = typeof baseMetadata === 'string' ? baseMetadata : '';

  return Object.getOwnPropertyNames(controller.prototype).flatMap(
    (propertyName) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        controller.prototype,
        propertyName,
      );
      const handler: unknown = descriptor?.value;

      if (typeof handler !== 'function') return [];

      const methodMetadata: unknown = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      );
      const pathMetadata: unknown = Reflect.getMetadata(PATH_METADATA, handler);

      if (typeof methodMetadata !== 'number') return [];

      const paths = Array.isArray(pathMetadata) ? pathMetadata : [pathMetadata];
      return paths
        .filter((path): path is string => typeof path === 'string')
        .map(
          (path) =>
            `${getMethodName(methodMetadata)} ${joinPaths(basePath, path)}`,
        );
    },
  );
}

// Une el prefijo y la ruta de un handler sin duplicar barras.
function joinPaths(basePath: string, methodPath: string): string {
  const segments = [basePath, methodPath]
    .flatMap((path) => path.split('/'))
    .filter(Boolean);

  return `/${segments.join('/')}`;
}

// Convierte el enum interno de Nest en el verbo HTTP esperado.
function getMethodName(method: RequestMethod): string {
  switch (method) {
    case RequestMethod.GET:
      return 'GET';
    case RequestMethod.POST:
      return 'POST';
    case RequestMethod.DELETE:
      return 'DELETE';
    case RequestMethod.PATCH:
      return 'PATCH';
    default:
      return RequestMethod[method];
  }
}

describe('rutas de publicaciones', () => {
  it('registra los cuatro controllers en MercadolibreModule', () => {
    const metadata: unknown = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      MercadolibreModule,
    );
    const registeredControllers: unknown[] = Array.isArray(metadata)
      ? metadata
      : [];
    const publicationControllers = registeredControllers.filter((controller) =>
      CONTROLLERS.some((expected) => expected === controller),
    );

    expect(publicationControllers).toEqual(CONTROLLERS);
  });

  it('registra una sola vez todas las rutas consumidas por Publicaciones', () => {
    const routes = CONTROLLERS.flatMap(getControllerRoutes).sort();

    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toEqual(EXPECTED_ROUTES);
  });
});
