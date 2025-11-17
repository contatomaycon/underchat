import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EZipcodePermissions } from '@core/common/enums/EPermissions/zipcode';

export const zipcodeViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EZipcodePermissions.zipcode_group,
  EZipcodePermissions.zipcode_view,
];
