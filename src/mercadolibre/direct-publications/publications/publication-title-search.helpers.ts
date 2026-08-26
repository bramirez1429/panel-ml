const NON_SEARCH_CHARACTERS = /[^\p{L}\p{N}]+/gu;
const DIACRITICS = /\p{M}+/gu;
const SEARCH_CURSOR_PREFIX = 'title-search:';

export function normalizeTitleSearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLocaleLowerCase()
    .replace(NON_SEARCH_CHARACTERS, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function hasTitleSearch(value: unknown): value is string {
  return normalizeTitleSearch(value).length > 0;
}

export function titleMatchesSearch(title: unknown, search: string): boolean {
  const titleTokens = normalizeTitleSearch(title).split(' ').filter(Boolean);
  const searchTokens = normalizeTitleSearch(search).split(' ').filter(Boolean);
  return (
    searchTokens.length > 0 &&
    searchTokens.every((searchToken) =>
      titleTokens.some((titleToken) => titleToken.includes(searchToken)),
    )
  );
}

export function encodeTitleSearchCursor(offset: number): string {
  return `${SEARCH_CURSOR_PREFIX}${offset}`;
}

export function decodeTitleSearchCursor(cursor?: string): number | null {
  if (cursor === undefined || !cursor.trim()) return 0;
  const match = /^title-search:(0|[1-9]\d*)$/u.exec(cursor);
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) ? offset : null;
}
