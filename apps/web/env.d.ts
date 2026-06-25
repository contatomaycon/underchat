import 'vue-router';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

interface ImportMetaEnv {
  readonly APP_ENVIRONMENT?: string;
  readonly VITE_APP_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'vue-router' {
  interface RouteMeta {
    permissions?: EPermissionsRoles[];
    requiredPlanProducts?: EPlanProduct[];
    layoutWrapperClasses?: string;
    navActiveLink?: RouteLocationRaw;
    layout?: 'blank' | 'default';
    unauthenticatedOnly?: boolean;
    public?: boolean;
  }
}
