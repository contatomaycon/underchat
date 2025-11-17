import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const accountViewPermissions = [
  EGeneralPermissions.full_access,
  EAccountPermissions.account_group,
  EAccountPermissions.account_view,
];
export const accountDeletePermissions = [
  EGeneralPermissions.full_access,
  EAccountPermissions.account_group,
  EAccountPermissions.account_delete,
];
export const accountUpdatePermissions = [
  EGeneralPermissions.full_access,
  EAccountPermissions.account_group,
  EAccountPermissions.account_update,
];
export const accountCreatePermissions = [
  EGeneralPermissions.full_access,
  EAccountPermissions.account_group,
  EAccountPermissions.account_create,
];
