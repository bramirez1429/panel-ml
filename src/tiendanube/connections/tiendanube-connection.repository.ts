export type SaveTiendanubeConnectionInput = Readonly<{
  userId: string;
  storeId: string;
  accessToken: string;
  tokenType: 'bearer';
  scope: string;
}>;

export type TiendanubeConnectionSummary = Readonly<{
  storeId: string;
  scope: string;
}>;

export abstract class TiendanubeConnectionRepository {
  abstract saveConnection(input: SaveTiendanubeConnectionInput): Promise<void>;
  abstract findSummaryByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionSummary | null>;
  abstract deleteByStoreId(storeId: string): Promise<void>;
}
