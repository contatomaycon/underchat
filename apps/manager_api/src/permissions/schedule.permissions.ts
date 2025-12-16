import { ESchedulePermissions } from '@core/common/enums/EPermissions/schedule';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const scheduleViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_view,
];

export const scheduleCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_create,
];

export const scheduleUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_update,
];

export const scheduleDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESchedulePermissions.schedule_group,
  ESchedulePermissions.schedule_delete,
];
