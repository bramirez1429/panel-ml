import {
  buildVariantLabel,
  firstTextValue,
  reduceSharedVariations,
} from './publication-normalizer.helpers';

describe('publication normalizer helpers', () => {
  it('deduplica variaciones SHARED para no duplicar stock', () => {
    const variations = reduceSharedVariations(
      [
        {
          id: 10,
          available_quantity: 4,
          sold_quantity: 2,
          attribute_combinations: [
            { id: 'COLOR', value_name: 'Negro' },
            { id: 'SIZE', value_name: 'S' },
          ],
        },
        { id: 10, available_quantity: 99 },
      ],
      'Producto',
    );

    expect(variations).toEqual([
      {
        id: '10',
        label: 'Negro | S',
        availableQuantity: 4,
        soldQuantity: 2,
        attributes: [
          { id: 'COLOR', valueName: 'Negro' },
          { id: 'SIZE', valueName: 'S' },
        ],
      },
    ]);
  });

  it('elige la primera imagen v\u00e1lida de una familia', () => {
    expect(
      firstTextValue(
        [
          { id: 'MLA1', thumbnail: null },
          { id: 'MLA2', thumbnail: ' image ' },
        ],
        'thumbnail',
      ),
    ).toBe('image');
  });

  it('construye etiquetas gen\u00e9ricas sin hardcodear categor\u00edas', () => {
    expect(
      buildVariantLabel(
        [
          { id: 'MATERIAL', valueName: 'Acero' },
          { id: 'CAPACITY', valueName: '1 L' },
        ],
        ['CAPACITY', 'MATERIAL'],
        null,
        'MLAU1',
      ),
    ).toBe('1 L | Acero');
  });
});
