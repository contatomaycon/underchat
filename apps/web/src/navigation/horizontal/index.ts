import { RouteNamedMap } from 'vue-router/auto-routes';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHomePermissions } from '@core/common/enums/EPermissions/home';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';

export default [
  {
    title: 'home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
    permissions: [EGeneralPermissions.full_access, EHomePermissions.home_view],
  },
  {
    title: 'server',
    to: { name: 'server' as keyof RouteNamedMap },
    icon: { icon: 'tabler-server' },
    permissions: [
      EGeneralPermissions.full_access,
      EServerPermissions.server_view,
    ],
  },
];
