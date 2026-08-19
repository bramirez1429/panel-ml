export type AttributeValueInput = {
  id?: string | null;
  name?: string | null;
};

export type AttributeInput = {
  id: string;

  valueId?: string | null;
  valueName?: string | null;

  values?: AttributeValueInput[];
};

export type AttributeUpdate = {
  attribute: AttributeInput;
};