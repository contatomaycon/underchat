import { RouteNamedMap } from 'vue-router/auto-routes';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EHomePermissions } from '@core/common/enums/EPermissions/home';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { ERolePermissions } from '@core/common/enums/EPermissions/role';

export default [
  {
    title: 'home',
    to: { name: 'root' as keyof RouteNamedMap },
    icon: { icon: 'tabler-smart-home' },
    permissions: [EGeneralPermissions.full_access, EHomePermissions.home_view],
  },
  {
    title: 'channels',
    to: { name: 'channels' as keyof RouteNamedMap },
    icon: { icon: 'tabler-plug' },
    permissions: [
      EGeneralPermissions.full_access,
      EWorkerPermissions.create_worker,
      EWorkerPermissions.update_worker,
      EWorkerPermissions.view_worker,
      EWorkerPermissions.delete_worker,
    ],
  },
  {
    title: 'roles',
    to: { name: 'roles' as keyof RouteNamedMap },
    icon: { icon: 'tabler-crosshair' },
    permissions: [
      EGeneralPermissions.full_access,
      ERolePermissions.role_list,
      ERolePermissions.role_view,
      ERolePermissions.role_create,
      ERolePermissions.role_edit,
      ERolePermissions.role_delete,
    ],
  },
  {
    title: 'server',
    to: { name: 'server' as keyof RouteNamedMap },
    icon: { icon: 'tabler-server' },
    permissions: [
      EGeneralPermissions.full_access,
      EServerPermissions.server_view,
      EServerPermissions.server_edit,
      EServerPermissions.server_create,
      EServerPermissions.server_delete,
    ],
  },
];
