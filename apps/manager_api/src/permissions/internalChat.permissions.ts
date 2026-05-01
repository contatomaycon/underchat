import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EInternalChatPermissions } from '@core/common/enums/EPermissions/internalChat';

export const internalChatReadPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_access,
];

export const internalChatWritePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_access,
];

export const internalChatGroupCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_create,
];

export const internalChatGroupUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_update,
];

export const internalChatGroupMembersPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_manage_members,
];

export const internalChatGroupTransferLeaderPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EInternalChatPermissions.internal_chat_group,
  EInternalChatPermissions.internal_chat_group_transfer_leader,
];
