import { BadRequestException } from '@nestjs/common';

import { parsePublicationSearchCriteria } from './publication-search-criteria';

describe('parsePublicationSearchCriteria', () => {
  it('detecta un familyId numérico', () => {
    expect(parsePublicationSearchCriteria('123456')).toEqual({
      type: 'FAMILY',
      value: '123456',
    });
  });

  it('detecta un MLA exacto', () => {
    expect(parsePublicationSearchCriteria('MLA1947917494')).toEqual({
      type: 'MLA',
      value: 'MLA1947917494',
    });
  });

  it('detecta una búsqueda por título', () => {
    expect(parsePublicationSearchCriteria('remera mujer')).toEqual({
      type: 'TITLE',
      value: 'remera mujer',
    });
  });

  it('rechaza una query vacía', () => {
    expect(() => parsePublicationSearchCriteria('   ')).toThrow(
      BadRequestException,
    );
  });
});
