export type ReserveTiendanubeProductLinkInput = Readonly<{
  userId: string;
  storeId: string;
  mlProductId: string;
  mlSourceKey: string;
}>;

export type Reservation =
  | Readonly<{
      outcome: 'RESERVED';
      linkId: string;
      reservationVersion: string;
    }>
  | Readonly<{
      outcome: 'PENDING';
    }>
  | Readonly<{
      outcome: 'COMPLETED';
      tiendanubeProductId: string;
    }>;

export type CompleteTiendanubeProductLinkInput = Readonly<{
  linkId: string;
  userId: string;
  storeId: string;
  mlProductId: string;
  mlSourceKey: string;
  reservationVersion: string;
  tiendanubeProductId: string;
}>;

export type FailTiendanubeProductLinkInput = Readonly<{
  linkId: string;
  userId: string;
  storeId: string;
  mlProductId: string;
  mlSourceKey: string;
  reservationVersion: string;
}>;

export type FindTiendanubeProductLinkStatusesInput = Readonly<{
  userId: string;
  storeId: string;
  mlProductIds: readonly string[];
}>;

export type TiendanubeProductLinkStatusRecord = Readonly<{
  mlProductId: string;
  status: 'PENDING' | 'FAILED' | 'COMPLETED';
  tiendanubeProductId: string | null;
}>;

export type SourceLink = Readonly<{
  sourceKey: string;
  tiendanubeProductId: string;
  status: 'PENDING' | 'FAILED' | 'COMPLETED';
}>;

export type SourceLinkRepository = Readonly<{
  findBySourceKey(
    input: Readonly<{
      userId: string;
      storeId: string;
      sourceKey: string;
    }>,
  ): Promise<SourceLink | null>;
  saveSourceLink(
    input: Readonly<{
      userId: string;
      storeId: string;
      sourceKey: string;
      tiendanubeProductId: string;
    }>,
  ): Promise<void>;
}>;

export abstract class TiendanubeProductLinkRepository {
  abstract reserve(
    input: ReserveTiendanubeProductLinkInput,
  ): Promise<Reservation>;

  abstract complete(input: CompleteTiendanubeProductLinkInput): Promise<void>;

  abstract fail(input: FailTiendanubeProductLinkInput): Promise<void>;

  abstract findStatusesByMlProductIds(
    input: FindTiendanubeProductLinkStatusesInput,
  ): Promise<readonly TiendanubeProductLinkStatusRecord[]>;
}
