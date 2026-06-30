import { setupLayouts } from 'virtual:meta-layouts';
import { App } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import { routes as autoRoutes } from 'vue-router/auto-routes';
import { setupGuards } from './guards';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';

const externalConnectionRouteName = 'connection-external-token';
const whatsappTemplatesRouteName = 'channels-whatsapp-templates';

const isExternalConnectionRoute = (route: RouteRecordRaw): boolean =>
  route.name === externalConnectionRouteName ||
  route.path === '/connection/external/:token' ||
  route.path === 'external/:token';

const removeAutoExternalConnectionRoute = (
  routes: readonly RouteRecordRaw[]
): RouteRecordRaw[] =>
  routes.flatMap((route) => {
    if (isExternalConnectionRoute(route)) {
      return [];
    }

    const nextRoute: RouteRecordRaw = { ...route };

    if (route.children?.length) {
      const children = removeAutoExternalConnectionRoute(route.children);

      if (children.length) {
        nextRoute.children = children;
      } else {
        delete nextRoute.children;
      }
    }

    if (!nextRoute.component && !nextRoute.redirect && !nextRoute.children) {
      return [];
    }

    return [nextRoute];
  });

const routes = setupLayouts([
  {
    path: '/connection/external/:token',
    name: externalConnectionRouteName,
    component: () => import('@/pages/connection/external/[token].vue'),
    meta: {
      layout: 'blank',
      public: true,
    },
  },
  {
    path: '/channels/:worker_id/whatsapp-templates',
    name: whatsappTemplatesRouteName,
    component: () =>
      import('@/pages/official-whatsapp-templates/[worker_id].vue'),
    meta: {
      permissions: [
        EGeneralPermissions.full_access,
        EGeneralPermissions.full_access_group,
        EWorkerPermissions.worker_group,
        EWorkerPermissions.view_worker,
        EWorkerPermissions.update_worker,
        EWorkerPermissions.delete_worker,
      ],
    },
  },
  ...removeAutoExternalConnectionRoute(autoRoutes),
]);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 60 };
    return { top: 0 };
  },
});

setupGuards(router);

export { router };

export default function applyRouter(app: App) {
  app.use(router);
}
