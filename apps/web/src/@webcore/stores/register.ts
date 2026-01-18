import { defineStore } from 'pinia';
import axios, { AxiosError } from 'axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { AuthRegisterSendTwoFactorRequest } from '@core/schema/register/sendTwoFactor/request.schema';
import { AuthRegisterVerifyCodeRequest } from '@core/schema/register/verifyCode/request.schema';
import { AuthRegisterVerifyCodeResponse } from '@core/schema/register/verifyCode/response.schema';
import { ViewRegisterZipcodeRequest } from '@core/schema/register/viewZipcode/request.schema';
import { RegisterZipcodeResponseSchema } from '@core/schema/register/viewZipcode/response.schema';
import { useCookie } from '@/@webcore/composable/useCookie';
import { ListRegisterStatesRequest } from '@core/schema/register/listStates/request.schema';
import { RegisterStateListResponse } from '@core/schema/register/listStates/response.schema';
import { ListRegisterCitiesRequest } from '@core/schema/register/listCities/request.schema';
import { RegisterCityListResponse } from '@core/schema/register/listCities/response.schema';
import { ListRegisterPlanWithItemsFinalResponse } from '@core/schema/register/listPlanWithItems/response.schema';
import { ListRegisterAvailableCrossSellFinalResponse } from '@core/schema/register/listAvailableCrossSell/response.schema';
import { ListCreditCardFeeResponse } from '@core/schema/config/listCreditCardFee/response.schema';
import { CreateRegisterOrderPaymentRequest } from '@core/schema/register/createOrderPayment/request.schema';
import { CreateRegisterOrderPaymentResponse } from '@core/schema/register/createOrderPayment/response.schema';
import { RegisterCentrifugoTokenResponse } from '@core/schema/register/centrifugoToken/response.schema';
import { ListMethodPaymentsResponse } from '@core/schema/register/listMethodPayments/response.schema';
import { normalizeBaseUrl } from '../utils/helpers';

export const useRegisterStore = defineStore('register', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    isLoading: false,
    registerToken: null as string | null,
    creditCardFee: null as ListCreditCardFeeResponse | null,
    methodPayments: [] as ListMethodPaymentsResponse,
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
    async sendTwoFactor(
      data: AuthRegisterSendTwoFactorRequest
    ): Promise<boolean> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
        return false;
      }

      this.isLoading = true;

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<
          IApiResponse<{ success: boolean; message: string }>
        >(`${url}/v1/register/send-two-factor`, data, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status) {
          this.showSnackbar(
            responseData?.message || this.i18n.global.t('register_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('register_code_sent'),
          EColor.success
        );
        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('register_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return false;
      } finally {
        this.isLoading = false;
      }
    },
    async verifyCode(data: AuthRegisterVerifyCodeRequest): Promise<boolean> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured') ||
            'Backend URL não configurada. Verifique o arquivo .env',
          EColor.error
        );
        return false;
      }

      this.isLoading = true;

      try {
        const currentLocale = this.i18n.global.locale;

        const response = await axios.post<
          IApiResponse<AuthRegisterVerifyCodeResponse>
        >(
          `${url}/v1/register/verify-code`,
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

        if (!responseData?.status || !responseData?.data?.token) {
          this.showSnackbar(
            responseData?.message ||
              this.i18n.global.t('register_code_invalid'),
            EColor.error
          );
          return false;
        }

        const tokenCookie = useCookie<string>('register_token');
        tokenCookie.value = responseData.data.token;
        this.registerToken = responseData.data.token;

        this.showSnackbar(
          this.i18n.global.t('register_code_verified'),
          EColor.success
        );
        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('register_code_invalid');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return false;
      } finally {
        this.isLoading = false;
      }
    },
    async viewZipcode(
      params: ViewRegisterZipcodeRequest
    ): Promise<RegisterZipcodeResponseSchema | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<RegisterZipcodeResponseSchema>
        >(`${url}/v1/register/view-zipcode`, {
          params,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        return responseData.data;
      } catch {
        return null;
      }
    },
    async listStates(
      params?: ListRegisterStatesRequest
    ): Promise<RegisterStateListResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<RegisterStateListResponse>
        >(`${url}/v1/register/states`, {
          params,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        return responseData.data;
      } catch {
        return null;
      }
    },
    async listCities(
      params: ListRegisterCitiesRequest
    ): Promise<RegisterCityListResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<RegisterCityListResponse>
        >(`${url}/v1/register/cities`, {
          params,
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        return responseData.data;
      } catch {
        return null;
      }
    },
    async listPlanWithItems(): Promise<ListRegisterPlanWithItemsFinalResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<ListRegisterPlanWithItemsFinalResponse>
        >(`${url}/v1/register/plans/with-items`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        return responseData.data;
      } catch {
        return null;
      }
    },
    async listAvailableCrossSell(): Promise<ListRegisterAvailableCrossSellFinalResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<ListRegisterAvailableCrossSellFinalResponse>
        >(`${url}/v1/register/plans/cross-sell/available`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        return responseData.data;
      } catch {
        return null;
      }
    },

    async getCreditCardFee(): Promise<ListCreditCardFeeResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<ListCreditCardFeeResponse>
        >(`${url}/v1/register/credit-card-fee`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          const message =
            responseData?.message ??
            this.i18n.global.t('credit_card_fee_not_found');

          this.showSnackbar(message, EColor.error);
          return null;
        }

        this.creditCardFee = responseData.data;
        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('credit_card_fee_update_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async createOrderPayment(
      input: CreateRegisterOrderPaymentRequest
    ): Promise<CreateRegisterOrderPaymentResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);
      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured'),
          EColor.error
        );
        return null;
      }

      const tokenCookie = useCookie<string>('register_token');
      if (!tokenCookie.value) {
        this.showSnackbar(
          this.i18n.global.t('register_token_invalid'),
          EColor.error
        );
        return null;
      }

      this.isLoading = true;

      try {
        const currentLocale = this.i18n.global.locale;
        const response = await axios.post<
          IApiResponse<CreateRegisterOrderPaymentResponse>
        >(`${url}/v1/register/order/payment`, input, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        this.isLoading = false;

        const responseData = response?.data;
        if (!responseData?.status || !responseData?.data) {
          const message =
            responseData?.message ||
            this.i18n.global.t('order_payment_creation_failed');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('order_payment_creation_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.isLoading = false;
        return null;
      }
    },
    async generateCentrifugoToken(
      accountId: string
    ): Promise<RegisterCentrifugoTokenResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);
      if (!url) {
        this.showSnackbar(
          this.i18n.global.t('backend_url_not_configured'),
          EColor.error
        );
        return null;
      }

      const tokenCookie = useCookie<string>('register_token');
      if (!tokenCookie.value) {
        this.showSnackbar(
          this.i18n.global.t('register_token_invalid'),
          EColor.error
        );
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const response = await axios.post<
          IApiResponse<RegisterCentrifugoTokenResponse>
        >(
          `${url}/v1/register/centrifugo/auth/token`,
          { account_id: accountId },
          {
            headers: {
              'Content-Type': 'application/json',
              'Accept-Language': currentLocale,
              Authorization: `Bearer ${tokenCookie.value}`,
            },
          }
        );

        const responseData = response?.data;
        if (!responseData?.status || !responseData?.data) {
          const message =
            responseData?.message ||
            this.i18n.global.t('centrifugo_token_generation_failed');
          this.showSnackbar(message, EColor.error);
          return null;
        }

        return responseData.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'centrifugo_token_generation_failed'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message || errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async listMethodPayments(): Promise<ListMethodPaymentsResponse | null> {
      const url = normalizeBaseUrl(import.meta.env.VITE_BACKEND_URL);

      if (!url) {
        return null;
      }

      try {
        const currentLocale = this.i18n.global.locale;
        const tokenCookie = useCookie<string>('register_token');

        if (!tokenCookie.value) {
          return null;
        }

        const response = await axios.get<
          IApiResponse<ListMethodPaymentsResponse>
        >(`${url}/v1/register/method-payments`, {
          headers: {
            'Content-Type': 'application/json',
            'Accept-Language': currentLocale,
            Authorization: `Bearer ${tokenCookie.value}`,
          },
        });

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          return null;
        }

        this.methodPayments = responseData.data;
        return responseData.data;
      } catch {
        return null;
      }
    },
  },
});
