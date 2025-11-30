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
import { EZipcodePermissions } from './zipcode';
import { EAccountPermissions } from './account';
import { EPlanPermissions } from './plan';
import { EMessageTemplatePermissions } from './messageTemplate';
import { ELabelTemplatePermissions } from './labelTemplate';
import { EContactPermissions } from './contact';
import { EContactGroupPermissions } from './contactGroup';
import { EPermissionPermissions } from './permission';
import { EExpenditurePermissions } from './expenditure';
import { EFinancialPermissions } from './financial';

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
  | EZipcodePermissions
  | EAccountPermissions
  | EPlanPermissions
  | EMessageTemplatePermissions
  | ELabelTemplatePermissions
  | EContactPermissions
  | EContactGroupPermissions
  | EPermissionPermissions
  | EExpenditurePermissions
  | EFinancialPermissions;
