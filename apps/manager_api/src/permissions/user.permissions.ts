import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';

export const userViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_view,
];
export const userDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_delete,
];
export const userUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_update,
];
export const userCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_create,
];
