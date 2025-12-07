import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';
import { EReportAttendancePermissions } from '@core/common/enums/EPermissions/reportAttendance';

export const reportAttendanceViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReportConversationHistoryPermissions.report_conversation_history_group,
  EReportAttendancePermissions.report_attendance_view,
];
