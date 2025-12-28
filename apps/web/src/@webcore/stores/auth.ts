import { defineStore } from 'pinia';
import axios, { AxiosError } from 'axios';
import axiosAuth from '@webcore/axios';
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
  setSectors,
  setToken,
  setUser,
  initializePlanStatus,
  persistPlanStatus,
} from '../localStorage/user';
import { updateAbilityPermissions } from '@/plugins/casl/ability';
import { normalizeBaseUrl } from '../utils/helpers';

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
    planIsActive: initializePlanStatus(),
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
    updatePlanStatus(isActive: boolean) {
      this.planIsActive = isActive;
      persistPlanStatus(isActive);
    },
    async login(login: string, password: string): Promise<boolean> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
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
        this.layout = data.data.layout;
        this.planIsActive = data.data.plan_is_active ?? false;

        setUser(this.user);
        setToken(this.token);
        setPermissions(this.permissions);
        setLayout(this.layout);
        setSectors(data.data.sectors ?? []);
        persistPlanStatus(this.planIsActive);
        updateAbilityPermissions(this.permissions);

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('login_invalid');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },

    async masterSessionLogin(accountId: string): Promise<boolean> {
      try {
        const response = await axiosAuth.post<
          IApiResponse<AuthLoginResponse | null>
        >(`/master-session/login`, {
          account_id: accountId,
        });

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
        this.layout = data.data.layout;
        this.planIsActive = data.data.plan_is_active ?? false;

        setUser(this.user);
        setToken(this.token);
        setPermissions(this.permissions);
        setLayout(this.layout);
        setSectors(data.data.sectors ?? []);
        persistPlanStatus(this.planIsActive);
        updateAbilityPermissions(this.permissions);

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('login_invalid');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
  },
});
