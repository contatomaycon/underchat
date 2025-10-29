import { EPermissionsRoles } from '../enums/EPermissions';
import { IJwtGroupHierarchy } from '../interfaces/IJwtGroupHierarchy';

export function hasRequiredPermission(
  actions: IJwtGroupHierarchy[],
  permissions?: EPermissionsRoles[] | null
): boolean {
  if (!permissions?.length || !actions?.length) {
    return true;
  }

  return actions.some((action) => permissions.includes(action.action_name));
}
