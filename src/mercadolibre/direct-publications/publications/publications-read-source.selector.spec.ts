import { selectPublicationsReadSource } from './publications-read-source.selector';
import type { MercadoLibrePublicationsReadSource } from './mercadolibre-publications-read-source';
import type { SupabasePublicationsReadSource } from './supabase-publications-read-source';

describe('selectPublicationsReadSource', () => {
  const mercadoLibre = {
    getGrouped: jest.fn(),
  } as unknown as MercadoLibrePublicationsReadSource;
  const supabase = {
    getGrouped: jest.fn(),
  } as unknown as SupabasePublicationsReadSource;

  it('usa Mercado Libre por default y cuando se configura explícitamente', () => {
    expect(
      selectPublicationsReadSource(undefined, mercadoLibre, supabase),
    ).toBe(mercadoLibre);
    expect(
      selectPublicationsReadSource('mercadolibre', mercadoLibre, supabase),
    ).toBe(mercadoLibre);
  });

  it('usa Supabase solamente con el valor válido', () => {
    expect(
      selectPublicationsReadSource('supabase', mercadoLibre, supabase),
    ).toBe(supabase);
  });

  it('falla claramente con un valor desconocido', () => {
    expect(() =>
      selectPublicationsReadSource('redis', mercadoLibre, supabase),
    ).toThrow('PUBLICATIONS_READ_SOURCE');
  });
});
