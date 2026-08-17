export type MlPaging = {
  limit: number;
  offset: number;
  total: number;
};

export type MlSearchResponse = {
  seller_id: string | number;
  results: string[];
  paging: MlPaging;
};

export type MlScanResponse = {
  results?: string[] | null;
  scroll_id?: string | null;
};