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

export type TiendanubeConnectionCredentials = Readonly<{
  storeId: string;
  accessToken: string;
  scope: string;
}>;

export type OwnedTiendanubeConnectionCredentials =
  TiendanubeConnectionCredentials & Readonly<{ userId: string }>;

export abstract class TiendanubeConnectionRepository {
  abstract saveConnection(input: SaveTiendanubeConnectionInput): Promise<void>;
  abstract findSummaryByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionSummary | null>;
  abstract findCredentialsByUserId(
    userId: string,
  ): Promise<TiendanubeConnectionCredentials | null>;
  abstract findOwnedCredentialsByUserId(
    userId: string,
  ): Promise<OwnedTiendanubeConnectionCredentials | null>;
  abstract findCredentialsByStoreId(
    storeId: string,
  ): Promise<OwnedTiendanubeConnectionCredentials | null>;
  abstract deleteByUserId(userId: string): Promise<void>;
  abstract deleteByStoreId(storeId: string): Promise<void>;
}
