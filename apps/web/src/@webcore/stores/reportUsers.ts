import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListUserFinalResponse,
  ListUserResponse,
} from '@core/schema/user/listUser/response.schema';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { IListUsers } from '../interfaces/IListUsers';
import { ViewUserEmailResponse } from '@core/schema/user/viewUserEmail/response.schema';
import { ViewUserPhoneResponse } from '@core/schema/user/viewUserPhone/response.schema';
import { ViewUserDocumentResponse } from '@core/schema/user/viewUserDocument/response.schema';

export const useReportUsersStore = defineStore('reportUsers', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListUserResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
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
    async listUsers(input?: IListUsers): Promise<ListUserFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListUserRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              search: input.search,
              user_status: input.user_status,
              account_id: input.account_id,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListUserFinalResponse>>(
          `/users/user`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async getUserEmailDecrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewUserEmailResponse>>(
          `/users/user/${userId}/email`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_email_decrypt_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.email ?? null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_email_decrypt_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserPhoneDecrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewUserPhoneResponse>>(
          `/users/user/${userId}/phone`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_phone_decrypt_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.phone ?? null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_phone_decrypt_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserDocumentDecrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewUserDocumentResponse>
        >(`/users/user/${userId}/document`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_document_decrypt_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.document ?? null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_document_decrypt_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
  },
});
