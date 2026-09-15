import type { RecentSale, SaveRecentSale } from './sales.types';

export abstract class RecentSalesRepository {
  abstract saveMany(sales: readonly SaveRecentSale[]): Promise<void>;
  abstract findSince(userId: string, since: Date): Promise<RecentSale[]>;
  abstract findById(userId: string, saleId: string): Promise<RecentSale | null>;
}
