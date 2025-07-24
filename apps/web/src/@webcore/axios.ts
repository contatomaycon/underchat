import axios, { type AxiosResponse } from 'axios';
import { getToken, removeUserData } from './localStorage/user';
import { router } from '@/plugins/1.router';
import { getI18n } from '@/plugins/i18n';

const createAxiosInstance = () => {
  return axios.create({
    baseURL: `${import.meta.env.VITE_BACKEND_URL}/v1`,
    timeout: 20000,
  });
};

const axiosAuth = createAxiosInstance();

axiosAuth.interceptors.request.use(
  (config) => {
    const token = getToken();
    const i18n = getI18n();

    const currentLocale = i18n.global.locale.value;

    if (token && config.headers) {
      config.headers['Authorization'] = `Bearer ${token}`;
      config.headers['Accept-Language'] = currentLocale;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
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

      removeUserData();

      router.push({ name: 'login' });
    }

    return Promise.reject(error);
  }
);

export default axiosAuth;
