const COLOR_NAMES = new Set(['color', 'colour', 'cor']);
const SIZE_NAMES = new Set(['size', 'talle', 'talla', 'tamanho', 'tamano']);

const SIZE_EQUIVALENTS: Readonly<Record<string, string>> = {
  'extra small': 'xs',
  'extra chico': 'xs',
  small: 's',
  chico: 's',
  medium: 'm',
  mediano: 'm',
  large: 'l',
  grande: 'l',
  'extra large': 'xl',
  extralarge: 'xl',
  'extra grande': 'xl',
  'extra extra large': 'xxl',
  'extra extra grande': 'xxl',
  unico: 'unico',
  unica: 'unico',
};

const COLOR_EQUIVALENTS: Readonly<Record<string, string>> = {
  black: 'negro',
  preto: 'negro',
  white: 'blanco',
  branco: 'blanco',
  red: 'rojo',
  vermelho: 'rojo',
  blue: 'azul',
  green: 'verde',
  gray: 'gris',
  grey: 'gris',
  cinza: 'gris',
  yellow: 'amarillo',
  amarelo: 'amarillo',
  pink: 'rosa',
  purple: 'violeta',
  roxo: 'violeta',
};

export function normalizeAttribute(value: string | null): string | null {
  if (!value?.trim()) return null;
  return value
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/\s+/gu, ' ');
}

export function normalizeSize(value: string | null): string | null {
  const normalized = normalizeAttribute(value);
  return normalized ? (SIZE_EQUIVALENTS[normalized] ?? normalized) : null;
}

export function normalizeColor(value: string | null): string | null {
  const normalized = normalizeAttribute(value);
  return normalized ? (COLOR_EQUIVALENTS[normalized] ?? normalized) : null;
}

export function attributeKind(
  id: string | null,
  name: string | null,
): 'color' | 'size' | null {
  const normalizedId = normalizeAttribute(id);
  const normalizedName = normalizeAttribute(name);
  if (
    normalizedId === 'color' ||
    (normalizedName !== null && COLOR_NAMES.has(normalizedName))
  )
    return 'color';
  if (
    normalizedId === 'size' ||
    (normalizedName !== null && SIZE_NAMES.has(normalizedName))
  )
    return 'size';
  return null;
}

export function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return null;
}

export function nonNegativeStock(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function localizedText(value: unknown): string | null {
  if (typeof value === 'string') return text(value);
  if (!isObject(value)) return null;
  for (const locale of ['es', 'pt', 'en']) {
    const localized = text(value[locale]);
    if (localized) return localized;
  }
  return Object.values(value).flatMap((entry) => text(entry) ?? [])[0] ?? null;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
