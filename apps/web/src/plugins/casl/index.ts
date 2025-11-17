import type { App } from 'vue';

import { abilitiesPlugin } from '@casl/vue';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { getPermissions } from '@webcore/localStorage/user';
import { ability } from './ability';

export default function applyCasl(app: App) {
  const permissions = getPermissions();

  const roles = permissions.map((permission: EPermissionsRoles) => ({
    action: permission,
    subject: permission,
  }));

  ability.update(roles);

  app.use(abilitiesPlugin, ability, {
    useGlobalProperties: true,
  });
}
