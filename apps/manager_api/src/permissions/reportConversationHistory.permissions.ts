import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EReportConversationHistoryPermissions } from '@core/common/enums/EPermissions/reportConversationHistory';

export const reportConversationHistoryViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EReportConversationHistoryPermissions.report_conversation_history_group,
  EReportConversationHistoryPermissions.report_conversation_history_view,
];
