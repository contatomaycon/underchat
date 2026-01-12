import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';

export const accountPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
];

export const accountCustomizePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EAccountPermissions.account_group,
  EAccountPermissions.account_customize,
];
