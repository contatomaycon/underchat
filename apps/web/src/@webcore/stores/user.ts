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
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';
import { ZipcodeResponseSchema } from '@core/schema/zipcode/viewZipcode/response.schema';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { ViewUserPhoneResponse } from '@core/schema/user/viewUserPhone/response.schema';
import { ViewUserEmailResponse } from '@core/schema/user/viewUserEmail/response.schema';
import { ViewUserDocumentResponse } from '@core/schema/user/viewUserDocument/response.schema';
import { ViewUserAddress1Response } from '@core/schema/user/viewUserAddress1/response.schema';
import { ViewUserAddress2Response } from '@core/schema/user/viewUserAddress2/response.schema';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';
import { ViewUserRoleResponse } from '@core/schema/user/viewUserRole/response.schema';

export const useUsersStore = defineStore('users', {
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
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListUserFinalResponse>>(
          `/user`,
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

    async viewUserById(userId: string): Promise<ViewUserResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewUserResponse>>(
          `/user/${userId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async viewZipcode(
      params: ViewZipcodeRequest
    ): Promise<ZipcodeResponseSchema | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ZipcodeResponseSchema>>(
          `/zipcode`,
          {
            params,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('zipcode_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addUser(payload: CreateUserRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/user`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage = data?.message ?? this.i18n.global.t('user_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('user_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateUser(
      payload: EditUserParamsRequest,
      body: UpdateUserRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/user/${payload.user_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('user_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteUser(userId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/user/${userId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_deleted_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('user_deleted_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_deleted_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getUserPhoneDecrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewUserPhoneResponse>>(
          `/user/${userId}/phone`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.phone;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserEmailDecrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewUserEmailResponse>>(
          `/user/${userId}/email`
        );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.email;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
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
        >(`/user/${userId}/document`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.document;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserAddress1Decrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewUserAddress1Response>
        >(`/user/${userId}/address1`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.address1;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserAddress2Decrypted(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<
          IApiResponse<ViewUserAddress2Response>
        >(`/user/${userId}/address2`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.address2;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },

    async getUserRole(userId: string): Promise<string | null> {
      try {
        const response = await axios.get<IApiResponse<ViewUserRoleResponse>>(
          `/user/${userId}/role`
        );

        const data = response?.data;

        if (!data?.status) {
          return null;
        }

        return data.data?.permission_role_id ?? null;
      } catch (error) {
        return null;
      }
    },

    async assignUserRole(
      userId: string,
      payload: AssignUserRoleRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<null>>(
          `/user/${userId}/role`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_role_assignment_failed');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('user_role_assigned_successfully'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_role_assignment_failed');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },
  },
});
