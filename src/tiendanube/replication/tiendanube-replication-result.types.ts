export type TiendanubeReplicationCreatedResult = Readonly<{
  ok: true;
  alreadyReplicated: false;
  mlProductId: string;
  tiendanubeProductId: string;
}>;

export type TiendanubeReplicationExistingResult = Readonly<{
  ok: true;
  alreadyReplicated: true;
  tiendanubeProductId: string;
}>;

export type TiendanubeReplicationResult =
  TiendanubeReplicationCreatedResult | TiendanubeReplicationExistingResult;

export type TiendanubeReplicationUpsertResult = Readonly<{
  ok: true;
  action: 'created' | 'updated';
  mercadolibreSourceId: string;
  tiendanubeProductId: string;
}>;
