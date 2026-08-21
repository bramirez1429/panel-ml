export type DescriptionUpdate = {
  plainText: string;
};

export type MlDescription = {
  text?: string;
  plain_text?: string;
  last_updated?: string;
  date_created?: string;
  snapshot?: unknown;
};
