export type FamilyUpdateAttributeValue = {
  id?: string | null;
  name?: string | null;
};

export type FamilyUpdateAttribute = {
  id?: string;
  name?: string;
  values: FamilyUpdateAttributeValue[];
};

export type FamilyUserProductUpdate = {
  id: string;
  attributes?: FamilyUpdateAttribute[];
};

export type FamilyUpdateRequest = {
  common_content?: {
    family_name?: string;
    domain_id?: string;
    attributes?: FamilyUpdateAttribute[];
  };

  user_products: FamilyUserProductUpdate[];
};

export type FamilyTaskResponse = {
  task_id: string;
  status: string;
  date_created?: string;
};

export type FamilyTaskReason = {
  code?: string;
  message?: string;
  type?: string;
  cause_id?: number;
  department?: string;
};

export type FamilyTaskUserProduct = {
  id: string;
  status: string;
  processed_date?: string;
  last_updated?: string;
  reasons?: FamilyTaskReason[] | null;
};

export type FamilyTaskStatusResponse = {
  task_id: string;
  status: string;
  user_products?: FamilyTaskUserProduct[];
  date_created?: string;
  last_updated?: string;
};
