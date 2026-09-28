import { BadRequestException } from '@nestjs/common';

import { parsePublicationSearchCriteria } from './publication-search-criteria';

describe('parsePublicationSearchCriteria', () => {
  it.each([
    ['123456', { type: 'FAMILY', value: '123456' }],
    ['MLA1947917494', { type: 'MLA', value: 'MLA1947917494' }],
    ['mla1947917494', { type: 'MLA', value: 'MLA1947917494' }],
    ['MLAU123456', { type: 'MLAU', value: 'MLAU123456' }],
    ['mlau123456', { type: 'MLAU', value: 'MLAU123456' }],
    ['remera mujer', { type: 'TITLE', value: 'remera mujer' }],
    ['  Remera   Miami  ', { type: 'TITLE', value: 'Remera Miami' }],
  ] as const)('clasifica %s', (query, expected) => {
    expect(parsePublicationSearchCriteria(query)).toEqual(expected);
  });

  it('rechaza una query vacía', () => {
    expect(() => parsePublicationSearchCriteria('   ')).toThrow(
      BadRequestException,
    );
  });
});
