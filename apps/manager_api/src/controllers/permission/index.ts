import { injectable } from 'tsyringe';
import { listPermissionGroups } from './methods/listPermissionGroups';
import { listPermissionGroupsUser } from './methods/listPermissionGroupsUser';
import { updateRolePermissions } from './methods/updateRolePermissions';

@injectable()
class PermissionController {
  public listPermissionGroups = listPermissionGroups;
  public listPermissionGroupsUser = listPermissionGroupsUser;
  public updateRolePermissions = updateRolePermissions;
}

export default PermissionController;
