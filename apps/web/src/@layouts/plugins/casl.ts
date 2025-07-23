import type { RouteLocationNormalized } from 'vue-router';
import type { NavGroup } from '@layouts/types';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';

export const can = (permission?: EPermissionsRoles): boolean => {
  if (!permission) return false;

  const ability = useAbility();

  return ability.can(permission, 'all');
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

  if (target?.meta?.permission) {
    return ability.can(target.meta.permission as EPermissionsRoles, 'all');
  }

  return to.matched.some((r) =>
    ability.can((r.meta.permission ?? '') as EPermissionsRoles, 'all')
  );
};
