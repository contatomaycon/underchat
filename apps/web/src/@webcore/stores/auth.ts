import { defineStore } from 'pinia';
import axios from 'axios';
import {
  AccountInfoResponse,
  AuthLoginResponse,
  AuthUserResponse,
} from '@core/schema/auth/login/response.schema';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import {
  setLayout,
  setPermissions,
  setToken,
  setUser,
} from '../localStorage/user';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    user: null as AuthUserResponse | null,
    token: null as string | null,
    permissions: [] as EPermissionsRoles[],
    layout: null as AccountInfoResponse | null,
  }),
  actions: {
    showSnackbar(message: string, color: EColor) {
      this.snackbar.message = message;
      this.snackbar.color = color;
      this.snackbar.status = true;
    },
    hideSnackbar() {
      this.snackbar.status = false;
    },
    async login(login: string, password: string): Promise<boolean> {
      const url = import.meta.env.VITE_BACKEND_URL;

      if (!url) {
        return false;
      }

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<
          IApiResponse<AuthLoginResponse | null>
        >(
          `${url}/v1/auth/login`,
          {
            login,
            password,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept-Language': currentLocale,
            },
          }
        );

        const data = response?.data;

        if (!data?.status) {
          this.showSnackbar(this.i18n.global.t('login_error'), EColor.error);

          return false;
        }

        if (!data.data) {
          this.showSnackbar(this.i18n.global.t('login_invalid'), EColor.error);

          return false;
        }

        this.user = data.data.user;
        this.token = data.data.token;
        this.permissions = (data.data.permissions ?? []) as EPermissionsRoles[];
        this.layout = data.data.layout as AccountInfoResponse;

        setUser(this.user);
        setToken(this.token);
        setPermissions(this.permissions);
        setLayout(this.layout);

        this.showSnackbar(this.i18n.global.t('login_success'), EColor.success);

        return true;
      } catch {
        this.showSnackbar(this.i18n.global.t('login_invalid'), EColor.error);

        return false;
      }
    },
  },
});
