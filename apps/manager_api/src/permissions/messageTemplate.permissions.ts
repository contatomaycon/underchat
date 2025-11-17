import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EMessageTemplatePermissions } from '@core/common/enums/EPermissions/messageTemplate';

export const messageTemplateViewPermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_view,
];
export const messageTemplateDeletePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_delete,
];
export const messageTemplateUpdatePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_update,
];
export const messageTemplateCreatePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_template_group,
  EMessageTemplatePermissions.message_create,
];
