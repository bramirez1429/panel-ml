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

export abstract class TiendanubeProductLinkRepository {
  abstract reserve(
    input: ReserveTiendanubeProductLinkInput,
  ): Promise<Reservation>;

  abstract complete(input: CompleteTiendanubeProductLinkInput): Promise<void>;

  abstract fail(input: FailTiendanubeProductLinkInput): Promise<void>;
}
