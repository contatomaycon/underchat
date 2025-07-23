import type { App } from 'vue';

import { createMongoAbility } from '@casl/ability';
import { abilitiesPlugin } from '@casl/vue';
import type { Subjects } from './ability';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';

export default function (app: App) {
  const cookie = useCookie<[EPermissionsRoles, Subjects][]>('userPermissions');
  const rules =
    cookie.value?.map(([action, subject]) => ({ action, subject })) ?? [];
  const initialAbility =
    createMongoAbility<[EPermissionsRoles, Subjects]>(rules);

  app.use(abilitiesPlugin, initialAbility, {
    useGlobalProperties: true,
  });
}
