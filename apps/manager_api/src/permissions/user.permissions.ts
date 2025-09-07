import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';

export const userListPermissions = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_list,
];
export const userViewPermissions = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_view,
];
export const userDeletePermissions = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_delete,
];
export const userUpdatePermissions = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_update,
];
export const userCreatePermissions = [
  EGeneralPermissions.full_access,
  EUserPermissions.user_create,
];
