import { injectable } from 'tsyringe';
import { listPermissionGroups } from './methods/listPermissionGroups';

@injectable()
class PermissionController {
  public listPermissionGroups = listPermissionGroups;
}

export default PermissionController;
