import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';

const CHAT_USER_STATUS_UPDATE_PERMISSIONS = new Set<string>([
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EChatPermissions.chat_group,
  EChatPermissions.chat_user_status_update,
]);

function hasAnyStatusPermission(actions: readonly string[]): boolean {
  if (!actions.length) {
    return false;
  }

  return actions.some((action) =>
    CHAT_USER_STATUS_UPDATE_PERMISSIONS.has(action)
  );
}

export function hasChatUserStatusUpdatePermissionByPermissions(
  permissions: string[]
): boolean {
  return hasAnyStatusPermission(permissions);
}

export function hasChatUserStatusUpdatePermissionByActions(
  actions: IJwtGroupHierarchy[]
): boolean {
  return hasAnyStatusPermission(actions.map((action) => action.action_name));
}
