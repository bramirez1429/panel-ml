import { isJsonObject } from '../../shared/mercadolibre.types';

const CURSOR_PREFIX = 'title-items:v1:';
const MAX_PENDING_ITEMS = 100;
const MAX_SCROLL_ID_LENGTH = 2048;

export type PublicationTitleItemsCursor = Readonly<{
  nextScrollId: string | null;
  pendingItemIds: string[];
  reachedEnd: boolean;
}>;

export function initialPublicationTitleItemsCursor(): PublicationTitleItemsCursor {
  return { nextScrollId: null, pendingItemIds: [], reachedEnd: false };
}

export function encodePublicationTitleItemsCursor(
  cursor: PublicationTitleItemsCursor,
): string {
  const payload = JSON.stringify({
    s: cursor.nextScrollId,
    p: cursor.pendingItemIds,
    e: cursor.reachedEnd,
  });
  return `${CURSOR_PREFIX}${Buffer.from(payload).toString('base64url')}`;
}

export function decodePublicationTitleItemsCursor(
  cursor?: string,
): PublicationTitleItemsCursor | null {
  if (cursor === undefined || !cursor.trim()) {
    return initialPublicationTitleItemsCursor();
  }
  if (!cursor.startsWith(CURSOR_PREFIX)) return null;

  try {
    const value = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString(
        'utf8',
      ),
    ) as unknown;
    if (!isJsonObject(value)) return null;
    const scrollId = value.s;
    const pending = value.p;
    const reachedEnd = value.e;
    if (
      !(
        scrollId === null ||
        (typeof scrollId === 'string' &&
          scrollId.length > 0 &&
          scrollId.length <= MAX_SCROLL_ID_LENGTH)
      ) ||
      !Array.isArray(pending) ||
      pending.length > MAX_PENDING_ITEMS ||
      pending.some(
        (itemId) => typeof itemId !== 'string' || !/^MLA\d+$/u.test(itemId),
      ) ||
      typeof reachedEnd !== 'boolean'
    ) {
      return null;
    }
    return {
      nextScrollId: scrollId,
      pendingItemIds: [...new Set(pending as string[])],
      reachedEnd,
    };
  } catch {
    return null;
  }
}
