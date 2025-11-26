import type { App } from 'vue';

import { abilitiesPlugin } from '@casl/vue';
import { getPermissions } from '@webcore/localStorage/user';
import { ability, updateAbilityPermissions } from './ability';

export default function applyCasl(app: App) {
  const permissions = getPermissions();

  updateAbilityPermissions(permissions);

  app.use(abilitiesPlugin, ability, {
    useGlobalProperties: true,
  });
}
