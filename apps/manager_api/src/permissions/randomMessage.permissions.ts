import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ERandomMessagePermissions } from '@core/common/enums/EPermissions/randomMessage';

export const randomMessageViewPermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_view,
];

export const randomMessageCreatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_create,
];

export const randomMessageUpdatePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_update,
];

export const randomMessageDeletePermissions = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  ERandomMessagePermissions.random_message_group,
  ERandomMessagePermissions.random_message_delete,
];
