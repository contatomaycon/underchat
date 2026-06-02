import type { Router, RouteLocationRaw } from 'vue-router';
import { canNavigate } from '@layouts/plugins/casl';
import { isLoggedIn } from '@/@webcore/localStorage/user';
import { useAuthStore } from '@/@webcore/stores/auth';

export const setupGuards = (router: Router) => {
  router.beforeEach((to): RouteLocationRaw | void => {
    const isLogged = isLoggedIn();
    const authStore = useAuthStore();
    const planActive = authStore.planIsActive;
    const planProducts = authStore.planProducts;
    const allowedPlanRoutes = new Set([
      'root',
      'index',
      'account-settings',
      'plans',
      'plans-checkout',
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

    const requiredPlanProducts = to.matched.flatMap((route) =>
      Array.isArray(route.meta.requiredPlanProducts)
        ? route.meta.requiredPlanProducts
        : []
    );

    if (
      requiredPlanProducts.length > 0 &&
      !requiredPlanProducts.every((productId) =>
        planProducts.includes(productId)
      )
    ) {
      return { name: 'not-authorized' };
    }

    if (!canNavigate(to) && to.matched.length) {
      return { name: 'not-authorized' };
    }
  });
};
