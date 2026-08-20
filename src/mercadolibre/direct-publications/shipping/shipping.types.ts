export type ShippingUpdate = {
  freeShipping?: boolean;
  localPickUp?: boolean;
};

export type ShippingInfo = {
  mode: string | null;
  logisticType: string | null;
  freeShipping: boolean;
  localPickUp: boolean;
  storePickUp: boolean;
  mandatoryFreeShipping: boolean;
  isFlex: boolean;
  isFull: boolean;
  isDropOff: boolean;
  tags: string[];
};
