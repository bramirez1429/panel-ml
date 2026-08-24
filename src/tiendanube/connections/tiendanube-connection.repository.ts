export type SaveTiendanubeConnectionInput = Readonly<{
  userId: string;
  storeId: string;
  accessToken: string;
  tokenType: 'bearer';
  scope: string;
}>;

export abstract class TiendanubeConnectionRepository {
  abstract saveConnection(input: SaveTiendanubeConnectionInput): Promise<void>;
}
