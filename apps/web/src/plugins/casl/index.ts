import type { App } from 'vue';

import { createMongoAbility } from '@casl/ability';
import { abilitiesPlugin } from '@casl/vue';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';
import { getPermissions } from '@/@core/localStorage/user';

export default function (app: App) {
  const permissions = getPermissions();

  const roles = permissions.map((permission: EPermissionsRoles) => ({
    action: permission,
    subject: permission,
  }));

  const initialAbility =
    createMongoAbility<[EPermissionsRoles, EPermissionsRoles]>(roles);

  app.use(abilitiesPlugin, initialAbility, {
    useGlobalProperties: true,
  });
}
