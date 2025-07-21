import { EPermissionsRoles } from '../enums/EPermissions';

export interface IJwtGroupHierarchy {
  permission_role_id: string;
  role_name: string;
  module_name: string;
  action_name: EPermissionsRoles;
}
