import {
  normalizeTitleSearch,
  titleMatchesSearch,
} from './publication-title-search.helpers';

describe('publication title search helpers', () => {
  it('ignora mayúsculas, tildes, puntuación y espacios repetidos', () => {
    expect(normalizeTitleSearch('  ÁLGODÓN,   Peinado!!! ')).toBe(
      'algodon peinado',
    );
    expect(
      titleMatchesSearch(
        'Pack X4 Unid Remeras Nenas Algodón Peinado',
        'ALGODON nena',
      ),
    ).toBe(true);
  });

  it('acepta todos los tokens sin importar el orden', () => {
    expect(
      titleMatchesSearch(
        'Pack X4 Unid Remeras Nenas Algodón Peinado',
        'nenas pack remeras',
      ),
    ).toBe(true);
  });

  it('acepta coincidencias parciales dentro de cada palabra', () => {
    expect(titleMatchesSearch('Buzo Mujer Brooklyn', 'brook buzo')).toBe(true);
    expect(titleMatchesSearch('Remeras', 'reme')).toBe(true);
  });

  it('exige que aparezcan todos los tokens', () => {
    expect(titleMatchesSearch('Remeras Nenas', 'remeras algodón')).toBe(false);
  });
});
