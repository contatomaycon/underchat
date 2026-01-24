import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReleasePermissions } from '@core/common/enums/EPermissions/release';

export const releaseViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReleasePermissions.release_group,
  EReleasePermissions.release_view,
];

export const releaseCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReleasePermissions.release_group,
  EReleasePermissions.release_create,
];

export const releaseDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReleasePermissions.release_group,
  EReleasePermissions.release_delete,
];

export const releaseUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReleasePermissions.release_group,
  EReleasePermissions.release_update,
];
