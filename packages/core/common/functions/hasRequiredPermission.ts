import { EPermissionsRoles } from '../enums/EPermissions';
import { IJwtGroupHierarchy } from '../interfaces/IJwtGroupHierarchy';

export function hasRequiredPermission(
  actions: IJwtGroupHierarchy[],
  permissions: EPermissionsRoles[]
): boolean {
  if (!permissions?.length || !actions?.length) {
    return false;
  }

  return actions.some((action) => permissions.includes(action.action_name));
}
