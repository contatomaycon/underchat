import { RouteNamedMap } from 'vue-router/auto-routes';
import { EGeneralPermissions } from '@main/common/enums/EPermissions/general';

export default [
  {
    title: 'Home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
    action: EGeneralPermissions.full_access,
  },
  {
    title: 'Second page',
    to: { name: 'second-page' as keyof RouteNamedMap },
    icon: { icon: 'tabler-file' },
  },
];
