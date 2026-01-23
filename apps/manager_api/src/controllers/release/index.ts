import { injectable } from 'tsyringe';
import { listRelease } from './methods/listRelease';
import { viewRelease } from './methods/viewRelease';
import { createRelease } from './methods/createRelease';
import { listReleaseUsers } from './methods/listReleaseUsers';
import { listReleaseAccounts } from './methods/listReleaseAccounts';
import { listReleasePermissionRoles } from './methods/listReleasePermissionRoles';

@injectable()
class ReleaseController {
  public listRelease = listRelease;
  public viewRelease = viewRelease;
  public createRelease = createRelease;
  public listReleaseUsers = listReleaseUsers;
  public listReleaseAccounts = listReleaseAccounts;
  public listReleasePermissionRoles = listReleasePermissionRoles;
}

export default ReleaseController;
