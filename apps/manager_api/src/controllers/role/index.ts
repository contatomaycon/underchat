import { injectable } from 'tsyringe';
import { listRole } from './methods/listRole';
import { viewRole } from './methods/viewRole';
import { deleteRole } from './methods/deleteRole';
import { editRole } from './methods/editRole';
import { createRole } from './methods/createRole';

@injectable()
class RoleController {
  public listRole = listRole;
  public viewRole = viewRole;
  public deleteRole = deleteRole;
  public editRole = editRole;
  public createRole = createRole;
}

export default RoleController;
