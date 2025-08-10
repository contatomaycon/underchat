import { EUserPermissions } from './user';
import { EHealthPermissions } from './health';
import { EServerPermissions } from './server';
import { EMetricsPermissions } from './metrics';
import { EGeneralPermissions } from './general';
import { EHomePermissions } from './home';
import { EWorkerPermissions } from './worker';
import { ERolePermissions } from './role';
import { EChatPermissions } from './chat';
import { ESectorPermissions } from './sector';

export type EPermissionsRoles =
  | EUserPermissions
  | EHealthPermissions
  | EServerPermissions
  | EGeneralPermissions
  | EMetricsPermissions
  | EHomePermissions
  | EWorkerPermissions
  | ERolePermissions
  | EChatPermissions
  | ESectorPermissions;
