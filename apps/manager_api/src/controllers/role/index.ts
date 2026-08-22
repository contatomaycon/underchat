import { injectable } from 'tsyringe';
import { listRole } from './methods/listRole';
import { viewRole } from './methods/viewRole';
import { deleteRole } from './methods/deleteRole';
import { editRole } from './methods/editRole';
import { createRole } from './methods/createRole';
import { blockRole } from './methods/blockRole';
import { unblockRole } from './methods/unblockRole';

@injectable()
class RoleController {
  public listRole = listRole;
  public viewRole = viewRole;
  public deleteRole = deleteRole;
  public editRole = editRole;
  public createRole = createRole;
  public blockRole = blockRole;
  public unblockRole = unblockRole;
}

export default RoleController;
