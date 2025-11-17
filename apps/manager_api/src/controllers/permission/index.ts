import { injectable } from 'tsyringe';
import { listPermissionGroups } from './methods/listPermissionGroups';
import { listPermissionGroupsUser } from './methods/listPermissionGroupsUser';

@injectable()
class PermissionController {
  public listPermissionGroups = listPermissionGroups;
  public listPermissionGroupsUser = listPermissionGroupsUser;
}

export default PermissionController;
