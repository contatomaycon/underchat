import type { EPermissionsRoles } from '@core/common/enums/EPermissions';

/**
 * A flat list grants access when any permission matches. A list of groups
 * requires one matching permission from every group.
 */
export type PublicApiPermissionRequirements =
  EPermissionsRoles[] | EPermissionsRoles[][];
