import {
  attributeKind,
  normalizeAttribute,
  normalizeColor,
  normalizeSize,
} from './variant-normalization';

describe('variant normalization', () => {
  it('normaliza mayusculas, espacios y tildes sin alterar el valor original', () => {
    const original = '  NÉGRO   AZABACHE  ';

    expect(normalizeAttribute(original)).toBe('negro azabache');
    expect(original).toBe('  NÉGRO   AZABACHE  ');
  });

  it('unifica equivalencias razonables de talle', () => {
    expect(normalizeSize('Medium')).toBe('m');
    expect(normalizeSize('Extra Grande')).toBe('xl');
    expect(normalizeSize('Única')).toBe('unico');
  });

  it('unifica equivalencias inequivocas de color', () => {
    expect(normalizeColor('BLACK')).toBe('negro');
    expect(normalizeColor('Prêto')).toBe('negro');
    expect(normalizeColor('gris')).toBe('gris');
  });

  it('reconoce nombres de atributos en ambos canales', () => {
    expect(attributeKind('COLOR', null)).toBe('color');
    expect(attributeKind(null, 'Talle')).toBe('size');
    expect(attributeKind(null, 'Material')).toBeNull();
  });
});
