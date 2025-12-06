import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosRequestConfig, AxiosError } from 'axios';
import { UpdatePhotoResponse } from '@core/schema/accountSettings/updatePhoto/response.schema';
import { DeletePhotoResponse } from '@core/schema/accountSettings/deletePhoto/response.schema';
import { UpdateAdditionalInfoResponse } from '@core/schema/accountSettings/updateAdditionalInfo/response.schema';
import { UpdateAdditionalInfoRequest } from '@core/schema/accountSettings/updateAdditionalInfo/request.schema';
import { UpdateAddressResponse } from '@core/schema/accountSettings/updateAddress/response.schema';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';
import { ViewPhoneResponse } from '@core/schema/accountSettings/viewPhone/response.schema';
import { ViewDocumentResponse } from '@core/schema/accountSettings/viewDocument/response.schema';
import { ViewAddressResponse } from '@core/schema/accountSettings/viewAddress/response.schema';
import { ViewAddress1Response } from '@core/schema/accountSettings/viewAddress1/response.schema';
import { ViewAddress2Response } from '@core/schema/accountSettings/viewAddress2/response.schema';
import { ViewAdditionalInfoResponse } from '@core/schema/accountSettings/viewAdditionalInfo/response.schema';
import { ChangePasswordResponse } from '@core/schema/accountSettings/changePassword/response.schema';
import { ChangePasswordRequest } from '@core/schema/accountSettings/changePassword/request.schema';
import { ViewCurrentPlanInvoiceResponse } from '@core/schema/accountSettings/viewCurrentPlanInvoice/response.schema';
import {
  ListAccountPaymentsFinalResponse,
  ListAccountPaymentsResponse,
} from '@core/schema/accountSettings/listAccountPayments/response.schema';
import { ListAccountPaymentsRequest } from '@core/schema/accountSettings/listAccountPayments/request.schema';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { ListUserCardsFinalResponse } from '@core/schema/plan/listUserCards/response.schema';
import {
  ListAccountAddonsFinalResponse,
  ListAccountAddonsResponse,
} from '@core/schema/accountSettings/listAccountAddons/response.schema';
import {
  ListAccountPlanProductsFinalResponse,
  ListAccountPlanProductsResponse,
} from '@core/schema/accountSettings/listAccountPlanProducts/response.schema';
import { CreateUserCardRequest } from '@core/schema/accountSettings/createUserCard/request.schema';
import { CreateUserCardResponse } from '@core/schema/accountSettings/createUserCard/response.schema';

export const useAccountSettingsStore = defineStore('accountSettings', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    accountPaymentsList: [] as ListAccountPaymentsResponse[],
    accountPaymentsPagings: {
      current_page: 1,
      total_pages: 1,
      per_page: 10,
      count: 0,
      total: 0,
    } as PagingResponseSchema,
    userCardsList: [] as ListUserCardsFinalResponse,
    accountAddonsList: [] as ListAccountAddonsResponse[],
    accountPlanProductsList: [] as ListAccountPlanProductsResponse[],
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
    async updatePhoto(photo: File): Promise<UpdatePhotoResponse | null> {
      try {
        this.loading = true;

        const formData = new FormData();
        formData.append('photo', photo);

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.patch<IApiResponse<UpdatePhotoResponse>>(
          '/account-settings/photo',
          formData,
          config
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_photo_upload_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('profile_photo_upload_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('profile_photo_upload_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async deletePhoto(): Promise<DeletePhotoResponse | null> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<DeletePhotoResponse>>(
          '/account-settings/photo'
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('profile_photo_delete_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('profile_photo_delete_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('profile_photo_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async updateAdditionalInfo(
      body: UpdateAdditionalInfoRequest
    ): Promise<UpdateAdditionalInfoResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<UpdateAdditionalInfoResponse>
        >('/account-settings/additional-info', body);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_info_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('user_info_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('user_info_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async updateAddress(
      body: UpdateAddressRequest
    ): Promise<UpdateAddressResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<UpdateAddressResponse>>(
          '/account-settings/address',
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_address_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('user_address_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('user_address_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async getPhoneDecrypted(): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewPhoneResponse>>(
          '/account-settings/phone'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.phone;
      } catch {
        return null;
      }
    },
    async getDocumentDecrypted(): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewDocumentResponse>>(
          '/account-settings/document'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.document;
      } catch {
        return null;
      }
    },
    async getAddressComplete(): Promise<ViewAddressResponse | null> {
      try {
        const response = await axios.get<IApiResponse<ViewAddressResponse>>(
          '/account-settings/address'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },
    async getAddress1Decrypted(): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewAddress1Response>>(
          '/account-settings/address1'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.address1;
      } catch {
        return null;
      }
    },
    async getAddress2Decrypted(): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewAddress2Response>>(
          '/account-settings/address2'
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data.address2;
      } catch {
        return null;
      }
    },
    async getAdditionalInfo(): Promise<ViewAdditionalInfoResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewAdditionalInfoResponse>
        >('/account-settings/additional-info');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        return null;
      }
    },
    async changePassword(
      body: ChangePasswordRequest
    ): Promise<ChangePasswordResponse | null> {
      try {
        this.loading = true;
        const response = await axios.patch<
          IApiResponse<ChangePasswordResponse>
        >('/account-settings/password', body);
        this.loading = false;
        const data = response?.data;
        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('password_change_error');
          this.showSnackbar(message, EColor.error);
          return null;
        }
        this.showSnackbar(
          data.message ?? this.i18n.global.t('password_change_success'),
          EColor.success
        );
        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('password_change_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async getCurrentPlanInvoice(): Promise<ViewCurrentPlanInvoiceResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewCurrentPlanInvoiceResponse>
        >('/account-settings/current-plan-invoice');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async listAccountPayments(
      query?: ListAccountPaymentsRequest
    ): Promise<ListAccountPaymentsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAccountPaymentsFinalResponse>
        >('/account-settings/payments', {
          params: query,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.accountPaymentsList = data.data.results;
        this.accountPaymentsPagings = data.data.pagings;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async listUserCards(): Promise<ListUserCardsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListUserCardsFinalResponse>
        >('/account-settings/cards');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.userCardsList = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async deleteUserCard(userCardId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<null>>(
          `/account-settings/cards/${userCardId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('card_deleted_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('card_deleted_success'),
          EColor.success
        );

        await this.listUserCards();
        await this.getCurrentPlanInvoice();

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('card_deleted_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
    async listAccountAddons(): Promise<ListAccountAddonsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAccountAddonsFinalResponse>
        >('/account-settings/addons');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.accountAddonsList = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async listAccountPlanProducts(): Promise<ListAccountPlanProductsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListAccountPlanProductsFinalResponse>
        >('/account-settings/plan-products');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.accountPlanProductsList = data.data;

        return data.data;
      } catch {
        this.loading = false;
        return null;
      }
    },
    async updateUserCardDefault(userCardId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<null>>(
          '/account-settings/cards/default',
          { user_card_id: userCardId }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('card_default_updated_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('card_default_updated_success'),
          EColor.success
        );

        await this.listUserCards();

        return true;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('card_default_updated_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return false;
      }
    },
    async createUserCard(
      data: CreateUserCardRequest
    ): Promise<CreateUserCardResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<CreateUserCardResponse>>(
          '/account-settings/cards',
          data
        );

        this.loading = false;

        const responseData = response?.data;

        if (!responseData?.status || !responseData?.data) {
          const message =
            responseData?.message ?? this.i18n.global.t('card_created_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          responseData.message ?? this.i18n.global.t('card_created_success'),
          EColor.success
        );

        await this.listUserCards();

        return responseData.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('card_created_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
  },
});
