import 'vue-router';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

interface ImportMetaEnv {
  readonly APP_ENVIRONMENT?: string;
  readonly CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP?: string;
  readonly OUTBOUND_WEBHOOK_ALLOW_LOCALHOST_HTTP?: string;
  readonly WHATSAPP_SESSION_DEBUG_ENABLED?: string;
  readonly VITE_APP_ENVIRONMENT?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_API_PUBLIC_URL?: string;
  readonly VITE_API_DOCS_URL?: string;
  readonly VITE_UNDERCHAT_CHROME_EXTENSION_URL?: string;
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
