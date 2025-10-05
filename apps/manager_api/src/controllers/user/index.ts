import { injectable } from 'tsyringe';
import { listUser } from './methods/listUser';
import { viewUser } from './methods/viewUser';
import { deleteUser } from './methods/deleteUser';
import { editUser } from './methods/editUser';
import { createUser } from './methods/createUser';

@injectable()
class UserController {
  public listUser = listUser;
  public viewUser = viewUser;
  public deleteUser = deleteUser;
  public updateUser = editUser;
  public createUser = createUser;
}

export default UserController;
