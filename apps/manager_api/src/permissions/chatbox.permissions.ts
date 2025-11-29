import { EChatboxPermissions } from '@core/common/enums/EPermissions/chatbox';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';

export const chatboxPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatboxPermissions.chatbox_group,
  EChatboxPermissions.chatbox_access,
];
