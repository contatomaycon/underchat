import { useAbility } from '@casl/vue';
import type { RouteLocationNormalized } from 'vue-router';
import type { NavGroup } from '@layouts/types';

export const can = (
  action: string | undefined,
  subject: string | undefined
) => {
  const vm = getCurrentInstance();

  if (!vm) return false;

  const localCan = vm.proxy && '$can' in vm.proxy;

  // @ts-expect-error We will get TS error in below line because we aren't using $can in component instance
  return localCan ? vm.proxy?.$can(action, subject) : true;
};

export const canViewNavMenuGroup = (item: NavGroup) => {
  const hasAnyVisibleChild = item.children.some((i) =>
    can(i.action, i.subject)
  );

  if (!(item.action && item.subject)) return hasAnyVisibleChild;

  return can(item.action, item.subject) && hasAnyVisibleChild;
};

export const canNavigate = (to: RouteLocationNormalized) => {
  const ability = useAbility();

  const targetRoute = to.matched[to.matched.length - 1];

  if (targetRoute?.meta?.action && targetRoute?.meta?.subject)
    return ability.can(targetRoute.meta.action, targetRoute.meta.subject);

  return to.matched.some((route) =>
    ability.can(route.meta.action, route.meta.subject)
  );
};
