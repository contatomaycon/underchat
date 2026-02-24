import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const chatPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.chat_access,
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
