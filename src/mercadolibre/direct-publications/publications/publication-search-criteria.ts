import { BadRequestException } from '@nestjs/common';

import type { PublicationSearchCriteria } from './publication-search.types';

const FAMILY_ID = /^\d+$/u;
const ITEM_ID = /^MLA\d+$/iu;

export function parsePublicationSearchCriteria(
  query: unknown,
): PublicationSearchCriteria {
  if (typeof query !== 'string' || !query.trim()) {
    throw new BadRequestException('q es obligatorio');
  }

  const value = query.trim();
  if (FAMILY_ID.test(value)) return { type: 'FAMILY', value };
  if (ITEM_ID.test(value)) return { type: 'MLA', value: value.toUpperCase() };
  return { type: 'TITLE', value };
}
