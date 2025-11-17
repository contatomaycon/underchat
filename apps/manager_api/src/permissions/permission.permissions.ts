import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPermissionPermissions } from '@core/common/enums/EPermissions/permission';

export const permissionViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPermissionPermissions.permission_group,
  EPermissionPermissions.permission_view,
];

export const permissionEditPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EPermissionPermissions.permission_group,
  EPermissionPermissions.permission_edit,
];
