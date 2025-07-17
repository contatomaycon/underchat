import { EPermissionsRoles } from '../enums/EPermissions';

export interface IApiKeyGroupHierarchy {
  permission_role_id: string;
  api_key_id: string;
  api_key: string;
  name: string;
  role_name: string;
  module_name: string;
  action_name: EPermissionsRoles;
}
