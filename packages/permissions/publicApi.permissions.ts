import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ELabelTemplatePermissions } from '@core/common/enums/EPermissions/labelTemplate';
import { ESectorPermissions } from '@core/common/enums/EPermissions/sector';
import { EUserPermissions } from '@core/common/enums/EPermissions/user';

/**
 * Permission allowlists shared by Manager and the public API. Keeping the
 * values here guarantees that public calls inherit the executor's current
 * permissions instead of receiving a parallel authorization model.
 */
export const chatPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.chat_access,
];

export const chatReadPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.chat_access,
  EChatPermissions.view_chatbot_messages,
  EChatbotPermissions.chatbot_group,
  EChatbotPermissions.chatbot_access,
];

export const contactViewPhonePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EContactPermissions.contact_group,
  EContactPermissions.contact_view_phone,
];

export const forwardToOutputChatbotPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.forward_to_output_chatbot,
];

export const generateMessageWithAiPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.generate_message_with_ai,
];

export const kanbanPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.chat_kanban,
];

export const viewChatAttendantsPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.view_chat_attendants_info,
];

export const labelTemplateViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_view,
];

export const labelTemplateDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_delete,
];

export const labelTemplateUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_update,
];

export const labelTemplateCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ELabelTemplatePermissions.label_template_group,
  ELabelTemplatePermissions.label_create,
];

export const sectorViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_view,
];

export const sectorDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_delete,
];

export const sectorEditPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_update,
];

export const sectorCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ESectorPermissions.sector_group,
  ESectorPermissions.sector_create,
];

export const userViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_view,
];

export const userDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_delete,
];

export const userUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_update,
];

export const userCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EUserPermissions.user_group,
  EUserPermissions.user_create,
];
