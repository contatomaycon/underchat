import type { AppAbility } from './ability';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';

declare module 'vue' {
  interface ComponentCustomProperties {
    $ability: AppAbility;
    $canPermission(permission: EPermissionsRoles[]): boolean;
  }
}
