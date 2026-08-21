export type StockLocation = {
  type: string;
  quantity: number;
  store_id?: string;
  network_node_id?: string;
};

export type UserProductStockResponse = {
  id: string;
  user_id: number;
  locations: StockLocation[];
};

export type ClassicStockUpdate = {
  quantity: number;
  variationId?: number;
};

export type NewStockUpdate = {
  quantity: number;

  // Solo necesario para seller_warehouse / multiorigen.
  storeId?: string;
  networkNodeId?: string;
};
