import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';

export const sectorViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_view,
];
export const sectorDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_delete,
];
export const sectorEditPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_update,
];
export const sectorCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_create,
];
