import type { Router, RouteLocationRaw } from 'vue-router';
import { canNavigate } from '@layouts/plugins/casl';
import { isLoggedIn } from '@/@webcore/localStorage/user';
import { getPlanStatus } from '@/@webcore/localStorage/user';
import { useAuthStore } from '@/@webcore/stores/auth';

export const setupGuards = (router: Router) => {
  router.beforeEach((to): RouteLocationRaw | void => {
    const isLogged = isLoggedIn();
    const authStore = useAuthStore();
    const planActive = authStore.planIsActive || getPlanStatus();
    const allowedPlanRoutes = new Set([
      'root',
      'index',
      'account-settings',
      'plans',
      'plan-expired',
    ]);
    const isPlanRouteAllowed =
      !to.name || allowedPlanRoutes.has(String(to.name));

    if (to.meta.unauthenticatedOnly) {
      return isLogged ? '/' : undefined;
    }

    if (to.meta.public) {
      return;
    }

    if (!isLogged && to.matched.length) {
      return {
        name: 'login',
        query: {
          ...to.query,
          to: to.fullPath === '/' ? undefined : to.path,
        },
      };
    }

    if (!planActive && to.matched.length && !isPlanRouteAllowed) {
      return { name: 'plan-expired' };
    }

    if (!canNavigate(to) && to.matched.length) {
      return { name: 'not-authorized' };
    }
  });
};
