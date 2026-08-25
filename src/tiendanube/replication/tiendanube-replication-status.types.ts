export type TiendanubeReplicationPublicStatus =
  'NOT_REPLICATED' | 'PENDING' | 'FAILED' | 'COMPLETED';

export type TiendanubeReplicationStatusItem =
  | Readonly<{
      mlProductId: string;
      status: 'NOT_REPLICATED' | 'PENDING' | 'FAILED';
    }>
  | Readonly<{
      mlProductId: string;
      status: 'COMPLETED';
      tiendanubeProductId: string;
    }>;

export type TiendanubeReplicationStatusResponse = Readonly<{
  items: readonly TiendanubeReplicationStatusItem[];
}>;

export type TiendanubeReplicationSourceStatusItem =
  | Readonly<{
      sourceKey: string;
      status: 'NOT_REPLICATED' | 'PENDING' | 'FAILED';
      tiendanubeProductId: null;
    }>
  | Readonly<{
      sourceKey: string;
      status: 'COMPLETED';
      tiendanubeProductId: string;
    }>;

export type TiendanubeReplicationSourceStatusResponse = Readonly<{
  items: readonly TiendanubeReplicationSourceStatusItem[];
}>;
