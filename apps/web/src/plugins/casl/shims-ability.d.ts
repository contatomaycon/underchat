import type { AppAbility } from './ability';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';

declare module 'vue' {
  interface ComponentCustomProperties {
    $ability: AppAbility;
    $can(permission: EPermissionsRoles[]): boolean;
  }
}
