import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReportAttendancePermissions } from '@core/common/enums/EPermissions/reportAttendance';

export const reportAttendanceViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReportAttendancePermissions.report_attendance_group,
  EReportAttendancePermissions.report_attendance_view,
];
