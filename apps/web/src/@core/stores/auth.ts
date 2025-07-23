import { defineStore } from 'pinia';
import axios from 'axios';
import {
  AuthLoginResponse,
  AuthUserResponse,
} from '@main/schema/auth/login/response.schema';
import { IApiResponse } from '@main/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@main/common/enums/EColor';
import { ISnackbar } from '@main/common/interfaces/ISnackbar';
import { EPermissionsRoles } from '@main/common/enums/EPermissions';
import { setPermissions, setToken, setUser } from '../localStorage/user';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    user: null as AuthUserResponse | null,
    token: null as string | null,
    permissions: [] as EPermissionsRoles[],
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
      const i18n = getI18n();

      try {
        const currentLocale = i18n.global.locale.value;

        const response = await axios.post<
          IApiResponse<AuthLoginResponse | null>
        >(
          'http://localhost:3002/v1/auth/login',
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
          this.showSnackbar(i18n.global.t('login_error'), EColor.error);

          return false;
        }

        if (!data.data) {
          this.showSnackbar(i18n.global.t('login_invalid'), EColor.error);

          return false;
        }

        this.user = data.data.user;
        this.token = data.data.token;
        this.permissions = (data.data.permissions ?? []) as EPermissionsRoles[];

        setUser(this.user);
        setToken(this.token);
        setPermissions(this.permissions);

        this.showSnackbar(i18n.global.t('login_success'), EColor.success);

        return true;
      } catch {
        this.showSnackbar(i18n.global.t('login_invalid'), EColor.error);

        return false;
      }
    },
  },
});
