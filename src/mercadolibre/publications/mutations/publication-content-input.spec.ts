import { BadRequestException } from '@nestjs/common';
import {
  parseScopedAttributes,
  parseScopedText,
} from './publication-content-input';

describe('publication content input', () => {
  it('interpreta ambos valores null como limpieza explicita', () => {
    expect(
      parseScopedAttributes({
        itemId: 'MLA123',
        attributes: [{ id: ' brand ', valueId: null, valueName: null }],
      }),
    ).toEqual({
      itemId: 'MLA123',
      attributes: [
        { id: 'BRAND', valueId: null, valueName: null, clear: true },
      ],
    });
  });

  it('permite una descripcion vacia cuando el endpoint habilita el borrado', () => {
    expect(
      parseScopedText(
        { itemId: 'MLA123', description: '   ' },
        'description',
        50_000,
        true,
      ),
    ).toEqual({ itemId: 'MLA123', value: '' });

    expect(() =>
      parseScopedText({ description: '   ' }, 'description', 50_000),
    ).toThrow(BadRequestException);
  });
});
