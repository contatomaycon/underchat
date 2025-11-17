import type { RouteLocationNormalized } from 'vue-router';
import type { NavGroup } from '@layouts/types';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ability } from '@/plugins/casl/ability';

export const can = (permissions?: EPermissionsRoles[]): boolean => {
  if (!permissions?.length) {
    return false;
  }

  for (const perm of permissions) {
    if (ability.can(perm, perm)) return true;
  }

  return false;
};

export const canViewNavMenuGroup = (item: NavGroup): boolean => {
  const hasAnyVisibleChild = item.children.some((i) => can(i.permissions));

  if (!item.permissions) {
    return hasAnyVisibleChild;
  }

  return can(item.permissions) && hasAnyVisibleChild;
};

export const canNavigate = (to: RouteLocationNormalized): boolean => {
  const hasPermission = (perms?: EPermissionsRoles[]): boolean => {
    if (!perms?.length) return false;

    for (const p of perms) {
      if (ability.can(p, p)) return true;
    }

    return false;
  };

  const target = to.matched.at(-1);
  if (hasPermission(target?.meta?.permissions)) {
    return true;
  }

  return to.matched.some((r) => hasPermission(r.meta.permissions));
};
