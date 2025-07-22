import { RouteNamedMap } from 'vue-router/auto-routes';

export default [
  {
    title: 'Home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
  },
  {
    title: 'Second page',
    to: { name: 'second-page' as keyof RouteNamedMap },
    icon: { icon: 'tabler-file' },
  },
];
