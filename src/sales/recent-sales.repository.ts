import type { RecentSale, SaveRecentSale } from './sales.types';

export abstract class RecentSalesRepository {
  abstract saveMany(sales: readonly SaveRecentSale[]): Promise<void>;
  /** Lectura compartida: la pertenencia operativa no depende del usuario del panel. */
  abstract findSince(since: Date): Promise<RecentSale[]>;
  abstract findById(saleId: string): Promise<RecentSale | null>;
}
