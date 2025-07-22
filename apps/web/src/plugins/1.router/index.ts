import { setupLayouts } from 'virtual:meta-layouts';
import { App } from 'vue';
import { createRouter, createWebHistory } from 'vue-router/auto';
import { routes as autoRoutes } from 'vue-router/auto-routes'; // ← rotas já tipadas

const routes = setupLayouts(autoRoutes);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to) {
    if (to.hash) return { el: to.hash, behavior: 'smooth', top: 60 };
    return { top: 0 };
  },
});

export { router };

export default function (app: App) {
  app.use(router);
}
