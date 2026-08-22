import type { Router, RouteLocationRaw } from 'vue-router';
import { canNavigate } from '@layouts/plugins/casl';
import { isLoggedIn } from '@/@webcore/localStorage/user';
import { useAuthStore } from '@/@webcore/stores/auth';

export const setupGuards = (router: Router) => {
  router.beforeEach(async (to): Promise<RouteLocationRaw | void> => {
    const isLogged = isLoggedIn();
    const authStore = useAuthStore();
    const allowedPlanRoutes = new Set([
      'root',
      'index',
      'account-settings',
      'plans',
      'plans-checkout',
      'plan-expired',
    ]);
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

    const requiredPlanProducts = to.matched.flatMap((route) =>
      Array.isArray(route.meta.requiredPlanProducts)
        ? route.meta.requiredPlanProducts
        : []
    );

    const isPlanRouteAllowed =
      !to.name || allowedPlanRoutes.has(String(to.name));

    if (!authStore.planIsActive && to.matched.length && !isPlanRouteAllowed) {
      return { name: 'plan-expired' };
    }

    if (
      requiredPlanProducts.length > 0 &&
      !requiredPlanProducts.every((productId) =>
        authStore.planProducts.includes(productId)
      )
    ) {
      return { name: 'not-authorized' };
    }

    if (!canNavigate(to) && to.matched.length) {
      return { name: 'not-authorized' };
    }
  });
};
