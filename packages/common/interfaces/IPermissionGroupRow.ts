export interface IPermissionGroupRow {
  permission_action_group_id: string;
  group_name: string;
  group_description: string | null;
  group_action: string;
  group_created_at: string;
  group_updated_at: string;
  permission_action_id: string | null;
  action: string | null;
  name: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}
