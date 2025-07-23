import type { Router, RouteLocationRaw } from 'vue-router';
import { canNavigate } from '@layouts/plugins/casl';
import { useAuthStore } from '@core/stores/auth';

export const setupGuards = (router: Router) => {
  router.beforeEach((to): RouteLocationRaw | void => {
    if (to.meta.public) {
      return;
    }

    const authStore = useAuthStore();
    const isLoggedIn = authStore.isLoggedIn();

    if (to.meta.unauthenticatedOnly) {
      return isLoggedIn ? '/' : undefined;
    }

    if (!canNavigate(to) && to.matched.length) {
      return isLoggedIn
        ? { name: 'not-authorized' }
        : {
            name: 'login',
            query: {
              ...to.query,
              to: to.fullPath !== '/' ? to.path : undefined,
            },
          };
    }

    return;
  });
};
