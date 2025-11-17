import axios, { InternalAxiosRequestConfig, type AxiosResponse } from 'axios';
import { getToken, removeUserData } from './localStorage/user';
import { router } from '@/plugins/1.router';
import { getI18n } from '@/plugins/i18n';

const createAxiosInstance = () =>
  axios.create({
    baseURL: `${import.meta.env.VITE_BACKEND_URL}/v1`,
    timeout: 20000,
  });

const axiosAuth = createAxiosInstance();

axiosAuth.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = getToken();
    const i18n = getI18n();
    const currentLocale = i18n.global.locale.value;

    if (config.headers) {
      if (token) config.headers['Authorization'] = `Bearer ${token}`;
      config.headers['Accept-Language'] = currentLocale;
    }

    return config;
  },
  (error: unknown) => {
    if (error instanceof Error) throw error;

    throw new Error(String(error));
  }
);

axiosAuth.interceptors.response.use(
  (response: AxiosResponse<unknown>) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response &&
      error.response.status === 401 &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      
      const token = getToken();
      const responseData = error.response.data as {
        status?: boolean;
        message?: string;
        data?: unknown;
        id?: string;
      };

      const isPermissionError =
        token &&
        responseData &&
        typeof responseData.status === 'boolean' &&
        responseData.status === false &&
        responseData.message &&
        responseData.id;

      if (!isPermissionError) {
        const { useChatStore } = await import('@webcore/stores/chat');
        const chatStore = useChatStore();
        chatStore.clearUser();
        removeUserData();
        router.push({ name: 'login' });
      }
    }

    const err = error instanceof Error ? error : new Error(String(error));
    throw err;
  }
);

export default axiosAuth;
