import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const serverCreatePermissions = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_create,
];

export const serverDeletePermissions = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_delete,
];

export const serverEditPermissions = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_edit,
];

export const serverViewPermissions = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_view,
];

export const serverLogsInstallPermissions = [
  EGeneralPermissions.full_access,
  EServerPermissions.server_logs_install,
];
