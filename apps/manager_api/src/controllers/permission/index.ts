import { injectable } from 'tsyringe';
import { listPermissionGroups } from './methods/listPermissionGroups';
import { listPermissionGroupsUser } from './methods/listPermissionGroupsUser';
import { updateRolePermissions } from './methods/updateRolePermissions';
import { listPermissionRoleAccount } from './methods/listPermissionRoleAccount';

@injectable()
class PermissionController {
  public listPermissionGroups = listPermissionGroups;
  public listPermissionGroupsUser = listPermissionGroupsUser;
  public updateRolePermissions = updateRolePermissions;
  public listPermissionRoleAccount = listPermissionRoleAccount;
}

export default PermissionController;
