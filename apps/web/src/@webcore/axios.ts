import axios, {
  InternalAxiosRequestConfig,
  AxiosHeaders,
  type AxiosResponse,
  type AxiosRequestHeaders,
} from 'axios';
import {
  getToken,
  setToken,
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
    authStore.updatePlanStatus(data.data.plan_is_active ?? false);
    setToken(refreshedToken);
    persistPlanStatus(data.data.plan_is_active ?? false);

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

const redirectToLoginWithFallback = async (): Promise<void> => {
  if (router.currentRoute.value?.name === 'login') {
    return;
  }

  const loginHref = getLoginHref();

  try {
    await router.replace({ name: 'login' });
  } catch {
    globalThis.location.replace(loginHref);
    return;
  }

  if (router.currentRoute.value?.name !== 'login') {
    globalThis.location.replace(loginHref);
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

axiosAuth.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();

    if (hasInvalidSession && token) {
      hasInvalidSession = false;
    }

    const currentLocale = getCurrentLocale();
    if (config.headers) {
      config.headers = applyAuthHeaders(
        config.headers as AxiosRequestHeaders | AxiosHeaders | undefined,
        token,
        currentLocale
      );
    }
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
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (error.response?.status === 403) {
      const blockedData = error?.response?.data
        ?.data as UserAttendanceHoursBlockedData;

      if (blockedData?.reason === 'user_attendance_hours_blocked') {
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
