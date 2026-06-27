import axios, {
  InternalAxiosRequestConfig,
  AxiosHeaders,
  type AxiosResponse,
  type AxiosRequestHeaders,
} from 'axios';
import {
  getToken,
  setToken,
  setPermissions,
  setPlanProducts,
  persistPlanStatus,
  removeUserData,
} from './localStorage/user';
import { teardownClientSession } from './utils/sessionTeardown';
import { router } from '@/plugins/1.router';
import { getI18n } from '@/plugins/i18n';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { RefreshTokenResponse } from '@core/schema/auth/refrehToken/response.schema';
import { normalizeBaseUrl } from './utils/helpers';
import { UserAttendanceHoursBlockedData } from '@core/schema/user/attendanceHours/shared.schema';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { updateAbilityPermissions } from '@/plugins/0.casl/ability';

const createAxiosInstance = () => {
  const baseUrl = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);
  return axios.create({
    baseURL: `${baseUrl}/v1`,
    timeout: 600000,
  });
};

const axiosAuth = createAxiosInstance();
const WEB_SESSION_PLATFORM = 'web';
let logoutAndRedirectPromise: Promise<void> | null = null;
let permissionDeniedRedirectPromise: Promise<void> | null = null;
let refreshSessionPromise: Promise<string | null> | null = null;
let hasInvalidSession = false;

const getCurrentLocale = (): string => {
  const i18n = getI18n();
  return i18n.global.locale.value;
};

const applyAuthHeaders = (
  headers: AxiosRequestHeaders | AxiosHeaders | undefined,
  token: string | null,
  locale: string
): AxiosRequestHeaders | AxiosHeaders => {
  const nextHeaders = AxiosHeaders.from(headers ?? {});
  nextHeaders.set('Accept-Language', locale);
  nextHeaders.set('X-Client-Platform', WEB_SESSION_PLATFORM);
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
};

const refreshSession = async (): Promise<string | null> => {
  if (hasInvalidSession) return null;

  const token = getToken();
  if (!token) return null;

  const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);
  if (!url) return null;

  try {
    const currentLocale = getCurrentLocale();
    const response = await axios.post<
      IApiResponse<RefreshTokenResponse | null>
    >(
      `${url}/v1/auth/refresh-token`,
      {},
      {
        headers: applyAuthHeaders(undefined, token, currentLocale),
      }
    );

    const data = response?.data;
    if (!data?.status) return null;
    if (!data.data) return null;

    const refreshedToken = data.data.token;
    const { useAuthStore } = await import('@webcore/stores/auth');
    const authStore = useAuthStore();
    authStore.token = refreshedToken;
    authStore.permissions = (data.data.permissions ??
      []) as EPermissionsRoles[];
    authStore.updatePlanStatus(data.data.plan_is_active ?? false);
    authStore.updatePlanProducts(data.data.plan_products ?? []);
    setToken(refreshedToken);
    setPermissions(authStore.permissions);
    persistPlanStatus(data.data.plan_is_active ?? false);
    setPlanProducts(data.data.plan_products ?? []);
    updateAbilityPermissions(authStore.permissions);

    return refreshedToken;
  } catch {
    return null;
  }
};

const refreshSessionWithSingleFlight = async (): Promise<string | null> => {
  if (hasInvalidSession || logoutAndRedirectPromise) {
    return null;
  }

  if (refreshSessionPromise) {
    return refreshSessionPromise;
  }

  refreshSessionPromise = refreshSession();

  try {
    return await refreshSessionPromise;
  } finally {
    refreshSessionPromise = null;
  }
};

const getLoginHref = (): string => {
  try {
    return router.resolve({ name: 'login' }).href || '/login';
  } catch {
    return '/login';
  }
};

const getNotAuthorizedHref = (): string => {
  try {
    return router.resolve({ name: 'not-authorized' }).href || '/not-authorized';
  } catch {
    return '/not-authorized';
  }
};

const redirectToLoginWithFallback = async (): Promise<void> => {
  if (String(router.currentRoute.value?.name ?? '') === 'login') {
    return;
  }

  const loginHref = getLoginHref();

  try {
    await router.replace({ name: 'login' });
  } catch {
    globalThis.location.replace(loginHref);
    return;
  }

  if (String(router.currentRoute.value?.name ?? '') !== 'login') {
    globalThis.location.replace(loginHref);
  }
};

const redirectToNotAuthorizedWithFallback = async (): Promise<void> => {
  if (String(router.currentRoute.value?.name ?? '') === 'not-authorized') {
    return;
  }

  const notAuthorizedHref = getNotAuthorizedHref();

  try {
    await router.replace({ name: 'not-authorized' });
  } catch {
    globalThis.location.replace(notAuthorizedHref);
    return;
  }

  if (String(router.currentRoute.value?.name ?? '') !== 'not-authorized') {
    globalThis.location.replace(notAuthorizedHref);
  }
};

const redirectPermissionDeniedWithSingleFlight = async (): Promise<void> => {
  if (permissionDeniedRedirectPromise) {
    return permissionDeniedRedirectPromise;
  }

  permissionDeniedRedirectPromise = redirectToNotAuthorizedWithFallback();

  try {
    await permissionDeniedRedirectPromise;
  } finally {
    permissionDeniedRedirectPromise = null;
  }
};

export const logoutAndRedirect = async (): Promise<void> => {
  if (logoutAndRedirectPromise) {
    return logoutAndRedirectPromise;
  }

  hasInvalidSession = true;

  // Clear persisted auth state immediately to stop new authenticated requests.
  removeUserData();

  logoutAndRedirectPromise = (async () => {
    const teardownPromise = teardownClientSession({
      notifyPushServer: false,
      notifyPresenceOffline: false,
    }).catch(() => {});

    await redirectToLoginWithFallback();
    await teardownPromise;
  })().catch(() => {
    globalThis.location.replace(getLoginHref());
  });

  try {
    await logoutAndRedirectPromise;
  } finally {
    logoutAndRedirectPromise = null;
  }
};

const updatePlanStatusFromResponse = async (
  response: AxiosResponse<unknown>
): Promise<void> => {
  const headerValueRaw =
    typeof response.headers?.get === 'function'
      ? response.headers.get('x-plan-active')
      : response.headers?.['x-plan-active'];

  if (headerValueRaw === undefined || headerValueRaw === null) return;

  const headerValue = String(headerValueRaw).toLowerCase() === 'true';
  const { useAuthStore } = await import('@webcore/stores/auth');
  const authStore = useAuthStore();
  if (authStore.planIsActive === headerValue) return;
  authStore.updatePlanStatus(headerValue);
};

const retryWithRefreshedToken = async (
  originalRequest: InternalAxiosRequestConfig
) => {
  const refreshedToken = await refreshSessionWithSingleFlight();
  if (!refreshedToken) return null;
  const headers = originalRequest.headers;
  originalRequest.headers = applyAuthHeaders(
    headers,
    refreshedToken,
    getCurrentLocale()
  );
  return axiosAuth(originalRequest);
};

const getApiResponseMessage = (responseData: unknown): string | null => {
  if (!responseData || typeof responseData !== 'object') {
    return null;
  }

  const message = (responseData as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
};

const isPermissionDeniedMessage = (message: string | null): boolean => {
  if (!message) {
    return false;
  }

  if (message === 'permission_denied') {
    return true;
  }

  const translatedMessage = getI18n().global.t('permission_denied');
  return typeof translatedMessage === 'string' && message === translatedMessage;
};

axiosAuth.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();

    if (hasInvalidSession && token) {
      hasInvalidSession = false;
    }

    const currentLocale = getCurrentLocale();
    config.headers = applyAuthHeaders(
      config.headers as AxiosRequestHeaders | AxiosHeaders | undefined,
      token,
      currentLocale
    );
    return config;
  },
  (error: unknown) => {
    if (error instanceof Error) throw error;

    throw new Error(String(error));
  }
);

axiosAuth.interceptors.response.use(
  async (response: AxiosResponse<unknown>) => {
    await updatePlanStatusFromResponse(response);
    return response;
  },
  async (error) => {
    const originalRequest = error.config as
      (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 403) {
      const blockedData = error?.response?.data
        ?.data as UserAttendanceHoursBlockedData;
      const isAttendanceBlocked =
        blockedData?.reason === 'user_attendance_hours_blocked';

      if (isAttendanceBlocked) {
        try {
          const { useAttendanceGuardStore } =
            await import('@webcore/stores/attendanceGuard');
          useAttendanceGuardStore().applyBlockedError(
            blockedData,
            error?.response?.data?.message ?? null
          );
        } catch {
          // ignore
        }
      } else {
        const apiMessage = getApiResponseMessage(error?.response?.data);
        if (isPermissionDeniedMessage(apiMessage)) {
          await redirectPermissionDeniedWithSingleFlight();
        }
      }
    }

    if (error.response?.status === 401) {
      if (hasInvalidSession || logoutAndRedirectPromise) {
        await logoutAndRedirect();
      } else if (originalRequest && !originalRequest._retry) {
        originalRequest._retry = true;

        const retried = await retryWithRefreshedToken(originalRequest);
        if (retried) return retried;
        await logoutAndRedirect();
      } else {
        await logoutAndRedirect();
      }

      const err = error instanceof Error ? error : new Error(String(error));
      throw err;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    throw err;
  }
);

export default axiosAuth;
