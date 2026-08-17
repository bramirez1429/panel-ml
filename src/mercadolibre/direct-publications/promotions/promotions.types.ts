export type MlPromotion = {
  id?: string;
  type?: string;
  sub_type?: string;
  status?: string;

  price?: number;
  original_price?: number;

  start_date?: string;
  finish_date?: string;

  name?: string;

  [key: string]: unknown;
};