import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EMessageTemplatePermissions } from '@core/common/enums/EPermissions/messageTemplate';

export const messageTemplateListPermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_list,
];
export const messageTemplateViewPermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_view,
];
export const messageTemplateDeletePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_delete,
];
export const messageTemplateUpdatePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_update,
];
export const messageTemplateCreatePermissions = [
  EGeneralPermissions.full_access,
  EMessageTemplatePermissions.message_create,
];
