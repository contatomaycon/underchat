import axios, {
  InternalAxiosRequestConfig,
  AxiosHeaders,
  type AxiosResponse,
  type AxiosRequestHeaders,
} from 'axios';
import { getToken, setToken, persistPlanStatus } from './localStorage/user';
import { clearAllData } from './utils/clearAllData';
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
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
};

const refreshSession = async (): Promise<string | null> => {
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

const logoutAndRedirect = async () => {
  try {
    const { useAttendanceGuardStore } =
      await import('@webcore/stores/attendanceGuard');
    useAttendanceGuardStore().shutdown();
  } catch {
    // ignore
  }

  clearAllData();
  router.push({ name: 'login' });
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
  const refreshedToken = await refreshSession();
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
    const originalRequest = error.config;

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

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const retried = await retryWithRefreshedToken(originalRequest);
      if (retried) return retried;
      await logoutAndRedirect();
    }

    const err = error instanceof Error ? error : new Error(String(error));
    throw err;
  }
);

export default axiosAuth;
