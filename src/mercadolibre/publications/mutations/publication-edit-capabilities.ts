import { isJsonObject } from '../../shared/mercadolibre.types';

export type EditCapabilities = Readonly<{
  canEditPrice: boolean;
  canEditStock: boolean;
  canEditSku: boolean;
  canPause: boolean;
  canActivate: boolean;
  canEditPictures: boolean;
}>;

/** Calcula permisos de edición con estado, tags y alcance vivos. */
export function editCapabilities(
  item: Record<string, unknown>,
  sellerTags: readonly string[],
  stockLocations: readonly string[],
  aggregate: boolean,
): EditCapabilities {
  const itemTags = strings(item.tags);
  const subStatuses = strings(item.sub_status);
  const status = typeof item.status === 'string' ? item.status : '';
  const mutable = !aggregate && ['active', 'paused'].includes(status);
  const warehouseManaged =
    sellerTags.includes('warehouse_management') ||
    stockLocations.includes('seller_warehouse');
  const onlyFulfillment =
    stockLocations.length > 0 &&
    stockLocations.every((location) => location === 'meli_facility');

  return {
    canEditPrice:
      mutable && !itemTags.includes('dynamic_standard_price'),
    canEditStock: mutable && !warehouseManaged && !onlyFulfillment,
    canEditSku: mutable,
    canPause: !aggregate && status === 'active',
    canActivate:
      !aggregate &&
      status === 'paused' &&
      !subStatuses.some((value) =>
        [
          'out_of_stock',
          'picture_download_pending',
          'picture_downloading_pending',
        ].includes(value),
      ),
    canEditPictures: mutable,
  };
}

/** Extrae tipos de location sin confiar en la respuesta externa. */
export function stockLocationTypes(value: unknown): string[] {
  if (!isJsonObject(value) || !Array.isArray(value.locations)) return [];
  return value.locations.flatMap((location) =>
    isJsonObject(location) && typeof location.type === 'string'
      ? [location.type]
      : [],
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
