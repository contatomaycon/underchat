import type { RouteLocationNormalized } from 'vue-router';
import type { NavGroup } from '@layouts/types';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { ability } from '@/plugins/casl/ability';
import { getPermissions } from '@webcore/localStorage/user';

const getGroupPermission = (
  permission: EPermissionsRoles
): EPermissionsRoles | null => {
  const permissionStr = String(permission);

  if (permissionStr.endsWith('_group')) {
    return null;
  }

  if (permissionStr.startsWith('permission_')) {
    return 'permission_group' as EPermissionsRoles;
  }

  if (permissionStr.startsWith('contact_group_assignment_')) {
    return 'contact_group_assignment_group' as EPermissionsRoles;
  }

  if (
    permissionStr.startsWith('message_') &&
    !permissionStr.startsWith('message_template_')
  ) {
    return 'message_template_group' as EPermissionsRoles;
  }

  if (
    permissionStr.startsWith('label_') &&
    !permissionStr.startsWith('label_template_')
  ) {
    return 'label_template_group' as EPermissionsRoles;
  }

  const parts = permissionStr.split('_');
  if (parts.length < 2) {
    return null;
  }

  const knownModules = [
    'user',
    'server',
    'contact',
    'role',
    'plan',
    'account',
    'sector',
    'worker',
    'home',
    'zipcode',
    'metrics',
    'chat',
  ];

  for (const module of knownModules) {
    if (
      permissionStr.includes(`_${module}_`) ||
      permissionStr.endsWith(`_${module}`)
    ) {
      const groupPermission = `${module}_group` as EPermissionsRoles;
      return groupPermission;
    }
  }

  const module = parts[0];
  const groupPermission = `${module}_group` as EPermissionsRoles;

  return groupPermission;
};

export const can = (permissions?: EPermissionsRoles[]): boolean => {
  if (!permissions?.length) {
    return false;
  }

  const userPermissions = getPermissions();

  for (const perm of permissions) {
    if (ability.can(perm, perm)) return true;

    const groupPermission = getGroupPermission(perm);
    if (groupPermission && userPermissions.includes(groupPermission)) {
      return true;
    }
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
  const target = to.matched.at(-1);
  if (can(target?.meta?.permissions)) {
    return true;
  }

  return to.matched.some((r) => can(r.meta.permissions));
};
