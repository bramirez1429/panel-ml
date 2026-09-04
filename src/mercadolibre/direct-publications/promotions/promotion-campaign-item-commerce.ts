import type { MlItem } from '../items/items.types';

export type PromotionCampaignItemCommerce =
  Readonly<{
    sku: string | null;
    stock: number | null;
    freeShipping: boolean | null;
    installmentLabel: string | null;
  }>;

export function promotionCampaignItemCommerceOf(
  item: MlItem | null,
): PromotionCampaignItemCommerce {
  return {
    sku: skuOf(item),
    stock: stockOf(item),
    freeShipping: freeShippingOf(item),
    installmentLabel:
      installmentLabelOf(item),
  };
}

export function financingCampaignTagOf(
  item: MlItem,
): string | null {
  const tags = normalizedTags(item);

  return (
    tags.find((tag) =>
      /^\d+x_campaign$/iu.test(tag),
    ) ??
    tags.find(
      (tag) =>
        tag.toLowerCase() ===
        'pcj-co-funded',
    ) ??
    tags.find((tag) =>
      /^ahora-\d+$/iu.test(tag),
    ) ??
    null
  );
}

function skuOf(
  item: MlItem | null,
): string | null {
  const direct =
    text(item?.seller_custom_field);

  if (direct) return direct;

  for (const attribute of
    item?.attributes ?? []) {
    const id =
      text(attribute.id)
        ?.toUpperCase();

    if (
      id !== 'SELLER_SKU' &&
      id !== 'SKU'
    ) {
      continue;
    }

    const value =
      text(attribute.value_name);

    if (value) return value;

    for (const candidate of
      attribute.values ?? []) {
      const candidateName =
        text(candidate.name);

      if (candidateName) {
        return candidateName;
      }
    }
  }

  return null;
}

function stockOf(
  item: MlItem | null,
): number | null {
  const value =
    item?.available_quantity;

  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  )
    ? value
    : null;
}

function freeShippingOf(
  item: MlItem | null,
): boolean | null {
  const value =
    item?.shipping?.free_shipping;

  return typeof value === 'boolean'
    ? value
    : null;
}

function installmentLabelOf(
  item: MlItem | null,
): string | null {
  if (!item) return null;

  const tags = normalizedTags(item);

  for (const tag of tags) {
    const match =
      /^(\d+)x_campaign$/iu.exec(tag);

    if (match?.[1]) {
      return `${match[1]} cuotas`;
    }
  }

  if (
    tags.some(
      (tag) =>
        tag.toLowerCase() ===
        'pcj-co-funded',
    )
  ) {
    return 'Cuotas con interés bajo';
  }

  /*
   * gold_pro indica una publicación
   * donde el vendedor agregó cuotas,
   * pero no inventamos una cantidad
   * cuando ML no la expone en tags.
   */
  if (
    item.listing_type_id === 'gold_pro'
  ) {
    return 'Cuotas agregadas';
  }

  return null;
}

function normalizedTags(
  item: MlItem,
): string[] {
  return (item.tags ?? [])
    .flatMap((value) => {
      const result = text(value);
      return result ? [result] : [];
    });
}

function text(
  value: unknown,
): string | null {
  return (
    typeof value === 'string' &&
    value.trim()
  )
    ? value.trim()
    : null;
}
