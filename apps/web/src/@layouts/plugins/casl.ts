import type { RouteLocationNormalized } from 'vue-router';
import type { NavGroup } from '@layouts/types';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';
import { useAbility } from '@/plugins/casl/composables/useAbility';

export const can = (permission?: EPermissionsRoles): boolean => {
  if (!permission) return false;

  const ability = useAbility();

  return ability.can(permission, permission);
};

export const canViewNavMenuGroup = (item: NavGroup): boolean => {
  const hasAnyVisibleChild = item.children.some((i) =>
    can(i.action as EPermissionsRoles)
  );

  if (!(item.action && item.subject)) {
    return hasAnyVisibleChild;
  }

  return can(item.action as EPermissionsRoles) && hasAnyVisibleChild;
};

export const canNavigate = (to: RouteLocationNormalized): boolean => {
  const ability = useAbility();
  const target = to.matched[to.matched.length - 1];

  if (target?.meta?.action) {
    return ability.can(
      target.meta.action as EPermissionsRoles,
      target.meta.action as EPermissionsRoles
    );
  }

  return to.matched.some((r) => {
    return ability.can(
      (r.meta.action ?? '') as EPermissionsRoles,
      (r.meta.action ?? '') as EPermissionsRoles
    );
  });
};
