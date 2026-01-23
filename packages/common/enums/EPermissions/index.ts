import { EUserPermissions } from './user';
import { EHealthPermissions } from './health';
import { EServerPermissions } from './server';
import { EMetricsPermissions } from './metrics';
import { EGeneralPermissions } from './general';
import { EHomePermissions } from './home';
import { EWorkerPermissions } from './worker';
import { ERolePermissions } from './role';
import { EChatPermissions } from './chat';
import { EChatbotPermissions } from './chatbot';
import { ESectorPermissions } from './sector';
import { EAccountPermissions } from './account';
import { EPlanPermissions } from './plan';
import { EMessageTemplatePermissions } from './messageTemplate';
import { ELabelTemplatePermissions } from './labelTemplate';
import { EContactPermissions } from './contact';
import { EContactGroupPermissions } from './contactGroup';
import { EPermissionPermissions } from './permission';
import { EExpenditurePermissions } from './expenditure';
import { EFinancialPermissions } from './financial';
import { EReportConversationHistoryPermissions } from './reportConversationHistory';
import { EReportAttendancePermissions } from './reportAttendance';
import { ESchedulePermissions } from './schedule';
import { EAiAgentPermissions } from './aiAgent';
import { EReleasePermissions } from './release';

export type EPermissionsRoles =
  | EUserPermissions
  | EHealthPermissions
  | EServerPermissions
  | EGeneralPermissions
  | EMetricsPermissions
  | EHomePermissions
  | EWorkerPermissions
  | ERolePermissions
  | EChatPermissions
  | EChatbotPermissions
  | ESectorPermissions
  | EAccountPermissions
  | EPlanPermissions
  | EMessageTemplatePermissions
  | ELabelTemplatePermissions
  | EContactPermissions
  | EContactGroupPermissions
  | EPermissionPermissions
  | EExpenditurePermissions
  | EFinancialPermissions
  | EReportConversationHistoryPermissions
  | EReportAttendancePermissions
  | ESchedulePermissions
  | EAiAgentPermissions
  | EReleasePermissions;
