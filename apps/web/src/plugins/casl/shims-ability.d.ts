import type { AppAbility } from './ability';

declare module 'vue' {
  interface ComponentCustomProperties {
    $ability: AppAbility;
    $can(this: this, permission: Parameters<AppAbility['can']>[0]): boolean;
  }
}
