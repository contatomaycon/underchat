import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHolidayPermissions } from '@core/common/enums/EPermissions/holiday';

export const holidayPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EHolidayPermissions.holiday_group,
  EHolidayPermissions.holiday_access,
];
