import { BadRequestException } from '@nestjs/common';

import type { PublicationSearchCriteria } from './publication-search.types';

const LEGACY_MLA_NUMBER_ID = /^\d{1,11}$/u;
const FAMILY_ID = /^\d{12,}$/u;
const ITEM_ID = /^MLA\d+$/iu;
const USER_PRODUCT_ID = /^MLAU\d+$/iu;

export function parsePublicationSearchCriteria(
  query: unknown,
): PublicationSearchCriteria {
  if (typeof query !== 'string' || !query.trim()) {
    throw new BadRequestException('q es obligatorio');
  }

  const value = query.trim().replace(/\s+/gu, ' ');
  if (USER_PRODUCT_ID.test(value)) {
    return { type: 'MLAU', value: value.toUpperCase() };
  }
  if (ITEM_ID.test(value)) return { type: 'MLA', value: value.toUpperCase() };
  if (LEGACY_MLA_NUMBER_ID.test(value)) {
    return { type: 'MLA', value: `MLA${value}` };
  }
  if (FAMILY_ID.test(value)) return { type: 'FAMILY', value };
  return { type: 'TITLE', value };
}
