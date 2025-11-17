import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';

export const roleViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERolePermissions.role_group,
  ERolePermissions.role_view,
];
export const roleDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERolePermissions.role_group,
  ERolePermissions.role_delete,
];
export const roleEditPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERolePermissions.role_group,
  ERolePermissions.role_edit,
];
export const roleCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERolePermissions.role_group,
  ERolePermissions.role_create,
];
