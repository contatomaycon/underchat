import type { Router, RouteLocationRaw } from 'vue-router';
import { canNavigate } from '@layouts/plugins/casl';
import { isLoggedIn } from '@/@core/localStorage/user';

export const setupGuards = (router: Router) => {
  router.beforeEach((to): RouteLocationRaw | void => {
    const isLogged = isLoggedIn();

    if (to.meta.unauthenticatedOnly) {
      return isLogged ? '/' : undefined;
    }

    if (to.meta.public) {
      return;
    }

    if (!canNavigate(to) && to.matched.length) {
      return isLogged
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
