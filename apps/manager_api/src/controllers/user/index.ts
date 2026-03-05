import { injectable } from 'tsyringe';
import { listUser } from './methods/listUser';
import { listAllUsers } from './methods/listAllUsers';
import { viewUser } from './methods/viewUser';
import { viewUserPhone } from './methods/viewUserPhone';
import { viewUserEmail } from './methods/viewUserEmail';
import { viewUserDocument } from './methods/viewUserDocument';
import { viewUserAddress1 } from './methods/viewUserAddress1';
import { viewUserAddress2 } from './methods/viewUserAddress2';
import { deleteUser } from './methods/deleteUser';
import { editUser } from './methods/editUser';
import { createUser } from './methods/createUser';
import { assignUserRole } from './methods/assignUserRole';
import { viewUserRole } from './methods/viewUserRole';
import { uploadPhoto } from './methods/uploadPhoto';
import { deletePhoto } from './methods/deletePhoto';
import { listUserRoles } from './methods/listUserRoles';
import { listUserSectors } from './methods/listUserSectors';
import { listUserChannels } from './methods/listUserChannels';
import { viewUserChannels } from './methods/viewUserChannels';
import { listUserAccounts } from './methods/listUserAccounts';
import { viewUserSectors } from './methods/viewUserSectors';
import { sessionLogin } from './methods/sessionLogin';
import { viewAttendanceHours } from './methods/viewAttendanceHours';
import { updateAttendanceHours } from './methods/updateAttendanceHours';
import { viewAttendanceHoursStatus } from './methods/viewAttendanceHoursStatus';

@injectable()
class UserController {
  public listUser = listUser;
  public listAllUsers = listAllUsers;
  public viewUser = viewUser;
  public viewUserPhone = viewUserPhone;
  public viewUserEmail = viewUserEmail;
  public viewUserDocument = viewUserDocument;
  public viewUserAddress1 = viewUserAddress1;
  public viewUserAddress2 = viewUserAddress2;
  public deleteUser = deleteUser;
  public updateUser = editUser;
  public createUser = createUser;
  public assignUserRole = assignUserRole;
  public viewUserRole = viewUserRole;
  public uploadPhoto = uploadPhoto;
  public deletePhoto = deletePhoto;
  public listUserRoles = listUserRoles;
  public listUserSectors = listUserSectors;
  public viewUserSectors = viewUserSectors;
  public listUserChannels = listUserChannels;
  public viewUserChannels = viewUserChannels;
  public listUserAccounts = listUserAccounts;
  public sessionLogin = sessionLogin;
  public viewAttendanceHours = viewAttendanceHours;
  public updateAttendanceHours = updateAttendanceHours;
  public viewAttendanceHoursStatus = viewAttendanceHoursStatus;
}

export default UserController;
