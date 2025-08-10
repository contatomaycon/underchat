import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';

export const sectorListPermissions = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_list,
];
export const sectorViewPermissions = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_view,
];
export const sectorDeletePermissions = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_delete,
];
export const sectorEditPermissions = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_edit,
];
export const sectorCreatePermissions = [
  EGeneralPermissions.full_access,
  ESectorPermissions.sector_create,
];
