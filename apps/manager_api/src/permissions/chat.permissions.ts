import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const viewChatPermissions = [
  EGeneralPermissions.full_access,
  EChatPermissions.view_chat,
];

export const createChatPermissions = [
  EGeneralPermissions.full_access,
  EChatPermissions.create_chat,
];

export const updateChatUserPermissions = [
  EGeneralPermissions.full_access,
  EChatPermissions.update_chat_user,
];
