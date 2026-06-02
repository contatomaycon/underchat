import 'vue-router';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

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
