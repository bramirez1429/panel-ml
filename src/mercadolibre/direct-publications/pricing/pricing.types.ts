export type MlPrice = {
  id?: string;
  type?: string;
  amount?: number;
  regular_amount?: number | null;
  currency_id?: string;

  conditions?: {
    context_restrictions?: string[];
    start_time?: string | null;
    end_time?: string | null;
  };
};

export type MlPricesResponse = {
  id: string;
  prices?: MlPrice[];
};

export type MlSalePriceResponse = {
  price_id?: string;
  amount?: number | null;
  regular_amount?: number | null;
  currency_id?: string;
  metadata?: Record<string, unknown>;
};