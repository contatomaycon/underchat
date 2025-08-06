import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const listChatPermissions = [
  EGeneralPermissions.full_access,
  EChatPermissions.list_chat,
];

export const listChatUserPermissions = [
  EGeneralPermissions.full_access,
  EChatPermissions.list_chat_user,
];
