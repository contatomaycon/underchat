import { App } from 'vue';
import { can } from '@layouts/plugins/casl';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';

export default {
  install(app: App) {
    app.config.globalProperties.$canPermission = (
      permission: EPermissionsRoles[]
    ) => can(permission);
  },
};
