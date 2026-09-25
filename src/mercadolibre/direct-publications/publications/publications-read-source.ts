import type { GroupedPublicationsResponse } from './publication.types';

export abstract class PublicationsReadSource {
  abstract getGrouped(
    userId: string,
    limit: number,
    cursor?: string,
    search?: string,
  ): Promise<GroupedPublicationsResponse>;
}
