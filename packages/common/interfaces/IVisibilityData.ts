export type VisibilityType = 'all' | 'contact_groups' | 'contacts';

export interface IVisibilityData {
  visibility_type: VisibilityType;
  contact_group_ids?: string[];
  contact_ids?: string[];
}
