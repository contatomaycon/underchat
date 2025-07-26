import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';

export const roleListPermissions = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_list,
];
export const roleViewPermissions = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_view,
];
export const roleDeletePermissions = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_delete,
];
export const roleEditPermissions = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_edit,
];
export const roleCreatePermissions = [
  EGeneralPermissions.full_access,
  ERolePermissions.role_create,
];
