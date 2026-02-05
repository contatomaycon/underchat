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
  setChannels,
  setToken,
  setUser,
  initializePlanStatus,
  persistPlanStatus,
} from '../localStorage/user';
import { updateAbilityPermissions } from '@/plugins/0.casl/ability';
import { normalizeBaseUrl } from '../utils/helpers';
import { AuthForgotPasswordSendCodeRequest } from '@core/schema/auth/forgotPassword/sendCode/request.schema';
import { AuthForgotPasswordSendCodeResponse } from '@core/schema/auth/forgotPassword/sendCode/response.schema';
import { AuthForgotPasswordVerifyCodeRequest } from '@core/schema/auth/forgotPassword/verifyCode/request.schema';
import { AuthForgotPasswordVerifyCodeResponse } from '@core/schema/auth/forgotPassword/verifyCode/response.schema';

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
        setChannels(data.data.channels ?? []);
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

    async userSessionLogin(userId: string): Promise<boolean> {
      try {
        const response = await axiosAuth.post<
          IApiResponse<AuthLoginResponse | null>
        >(`/user/${userId}/session-login`);

        const data = response?.data;

        if (!data?.status) {
          const errorMessage =
            data?.message ?? this.i18n.global.t('login_error');
          this.showSnackbar(errorMessage, EColor.error);

          return false;
        }

        if (!data.data) {
          const errorMessage =
            data?.message ?? this.i18n.global.t('login_invalid');
          this.showSnackbar(errorMessage, EColor.error);

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
        setChannels(data.data.channels ?? []);
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

    setLoginData(data: AuthLoginResponse) {
      this.user = data.user;
      this.token = data.token;
      this.permissions = (data.permissions ?? []) as EPermissionsRoles[];
      this.layout = data.layout;
      this.planIsActive = data.plan_is_active ?? false;

      setUser(this.user);
      setToken(this.token);
      setPermissions(this.permissions);
      setLayout(this.layout);
      setSectors(data.sectors ?? []);
      setChannels(data.channels ?? []);
      persistPlanStatus(this.planIsActive);
      updateAbilityPermissions(this.permissions);
    },

    async forgotPasswordSendCode(
      data: AuthForgotPasswordSendCodeRequest
    ): Promise<AuthForgotPasswordSendCodeResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<
          IApiResponse<AuthForgotPasswordSendCodeResponse>
        >(`${url}/v1/auth/forgot-password/send-code`, data, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          this.showSnackbar(
            responseData?.message ||
              this.i18n.global.t('forgot_password_error'),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('forgot_password_code_sent'),
          EColor.success
        );
        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('forgot_password_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async forgotPasswordVerifyCode(
      data: AuthForgotPasswordVerifyCodeRequest
    ): Promise<AuthForgotPasswordVerifyCodeResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<
          IApiResponse<AuthForgotPasswordVerifyCodeResponse>
        >(
          `${url}/v1/auth/forgot-password/verify-code`,
          {
            code: data.code.toUpperCase(),
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept-Language': currentLocale,
            },
          }
        );

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          this.showSnackbar(
            responseData?.message ||
              this.i18n.global.t('forgot_password_code_invalid'),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('forgot_password_code_verified'),
          EColor.success
        );
        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('forgot_password_code_invalid');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },

    async forgotPasswordResetPassword(
      token: string,
      data: { new_password: string; confirm_password: string }
    ): Promise<AuthLoginResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<IApiResponse<AuthLoginResponse>>(
          `${url}/v1/auth/forgot-password/reset-password`,
          data,
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept-Language': currentLocale,
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          this.showSnackbar(
            responseData?.message || this.i18n.global.t('password_reset_error'),
            EColor.error
          );
          return null;
        }

        this.setLoginData(responseData.data);

        this.showSnackbar(
          this.i18n.global.t('password_reset_success'),
          EColor.success
        );
        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('password_reset_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
  },
});
