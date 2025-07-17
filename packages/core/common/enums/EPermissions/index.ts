import { EUserPermissions } from './user';
import { EHealthPermissions } from './health';
import { EServerPermissions } from './server';

export type EPermissionsRoles =
  | EUserPermissions
  | EHealthPermissions
  | EServerPermissions;
