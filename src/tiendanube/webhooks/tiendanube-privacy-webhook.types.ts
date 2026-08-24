export type TiendanubeIncomingWebhook = Readonly<{
  rawBody: Buffer | undefined;
  signature: unknown;
  payload: unknown;
}>;

export type TiendanubeStoreRedactPayload = Readonly<{
  storeId: string;
}>;

export type TiendanubeCustomerPrivacyPayload = Readonly<{
  storeId: string;
  customerId: string;
}>;

export function parseStoreRedactPayload(
  value: unknown,
): TiendanubeStoreRedactPayload | null {
  if (!isJsonObject(value)) return null;

  const storeId = normalizeExternalId(value.store_id);
  return storeId ? { storeId } : null;
}

export function parseCustomerPrivacyPayload(
  value: unknown,
): TiendanubeCustomerPrivacyPayload | null {
  if (!isJsonObject(value) || !isJsonObject(value.customer)) return null;

  const storeId = normalizeExternalId(value.store_id);
  const customerId = normalizeExternalId(value.customer.id);
  return storeId && customerId ? { storeId, customerId } : null;
}

function normalizeExternalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
    return value.trim();
  }

  return null;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
