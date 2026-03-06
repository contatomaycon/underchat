import { EPermissionRole } from '@core/common/enums/EPermissionRole';

export function isMasterOrAdministratorRole(
  permissionRoleId: string | null | undefined
): boolean {
  if (typeof permissionRoleId !== 'string') {
    return false;
  }

  const normalizedRoleId = permissionRoleId.trim().toLowerCase();
  if (!normalizedRoleId) {
    return false;
  }

  return (
    normalizedRoleId === EPermissionRole.master ||
    normalizedRoleId === EPermissionRole.administrator
  );
}
