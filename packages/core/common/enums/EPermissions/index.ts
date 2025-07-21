import { EUserPermissions } from './user';
import { EHealthPermissions } from './health';
import { EServerPermissions } from './server';
import { EMetricsPermissions } from './metrics';
import { EGeneralPermissions } from './general';

export type EPermissionsRoles =
  | EUserPermissions
  | EHealthPermissions
  | EServerPermissions
  | EGeneralPermissions
  | EMetricsPermissions;
