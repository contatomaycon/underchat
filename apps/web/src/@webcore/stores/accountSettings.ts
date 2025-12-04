import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import axios from '@webcore/axios';
import { AxiosRequestConfig, AxiosError } from 'axios';
import { UpdatePhotoResponse } from '@core/schema/accountSettings/updatePhoto/response.schema';
import { UpdateAdditionalInfoResponse } from '@core/schema/accountSettings/updateAdditionalInfo/response.schema';
import { UpdateAdditionalInfoRequest } from '@core/schema/accountSettings/updateAdditionalInfo/request.schema';
import { UpdateAddressResponse } from '@core/schema/accountSettings/updateAddress/response.schema';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';
import { ViewPhoneResponse } from '@core/schema/accountSettings/viewPhone/response.schema';
import { ViewDocumentResponse } from '@core/schema/accountSettings/viewDocument/response.schema';
import { ViewAddressResponse } from '@core/schema/accountSettings/viewAddress/response.schema';
import { ViewAddress1Response } from '@core/schema/accountSettings/viewAddress1/response.schema';
import { ViewAddress2Response } from '@core/schema/accountSettings/viewAddress2/response.schema';

export const useAccountSettingsStore = defineStore('accountSettings', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
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
      } catch (error) {
        return null;
      }
    },
  },
});
