import { PublicationModelDetectorService } from './publication-model-detector.service';

describe('PublicationModelDetectorService', () => {
  const detector = new PublicationModelDetectorService();

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['vacío', ''],
    ['espacios', '   '],
    ['tipo incorrecto', 123],
  ])(
    'detecta SHARED con family_name %s aunque existan MLAU',
    (_, familyName) => {
      expect(
        detector.detect({
          family_name: familyName,
          user_product_id: 'MLAU100',
          tags: ['user_product_listing'],
          variations: [{ user_product_id: 'MLAU200' }],
        }),
      ).toBe('SHARED');
    },
  );

  it('detecta VARIANT_PRICING solo por family_name no vacío', () => {
    expect(detector.detect({ family_name: '  Remera Nena K-pop  ' })).toBe(
      'VARIANT_PRICING',
    );
  });
});
