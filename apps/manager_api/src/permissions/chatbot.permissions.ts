import { EChatbotPermissions } from '@core/common/enums/EPermissions/chatbot';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const chatbotPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatbotPermissions.chatbot_group,
  EChatbotPermissions.chatbot_access,
];
