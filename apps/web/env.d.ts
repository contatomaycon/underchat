import 'vue-router';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';

declare module 'vue-router' {
  interface RouteMeta {
    permissions?: EPermissionsRoles[];
    layoutWrapperClasses?: string;
    navActiveLink?: RouteLocationRaw;
    layout?: 'blank' | 'default';
    unauthenticatedOnly?: boolean;
    public?: boolean;
  }
}
