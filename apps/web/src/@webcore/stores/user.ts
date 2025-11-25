import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  ListUserFinalResponse,
  ListUserResponse,
} from '@core/schema/user/listUser/response.schema';
import { ListUserRequest } from '@core/schema/user/listUser/request.schema';
import { IListUsers } from '../interfaces/IListUsers';
import { ViewUserResponse } from '@core/schema/user/viewUser/response.schema';
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

    extractFieldValue(
      field: string | { value: string | null } | null | undefined
    ): string | null {
      if (field === null || field === undefined) {
        return null;
      }

      if (typeof field === 'object' && 'value' in field) {
        return field.value ?? null;
      }

      if (typeof field === 'string') {
        return field;
      }

      return null;
    },

    async addUser(
      payload: {
        email: string;
        password: string;
        account_id?: string | undefined;
        user_info: {
          phone_ddi: string;
          phone: string;
          name: string;
          last_name: string;
          birth_date: string | null;
        };
        user_document: {
          user_document_type_id: string;
          document: string;
        };
        user_address: {
          country_id: number;
          zip_code: string;
          address1: string;
          address2: string | null;
          city_fiscal_code: string | null;
          state_fiscal_code: string | null;
          district: string;
        };
      },
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();

        formData.append('email', payload.email);
        formData.append('password', payload.password);

        if (payload.account_id) {
          formData.append('account_id', payload.account_id);
        }

        formData.append('phone_ddi', payload.user_info.phone_ddi);
        formData.append('phone', payload.user_info.phone);
        formData.append('name', payload.user_info.name);
        formData.append('last_name', payload.user_info.last_name);
        if (payload.user_info.birth_date) {
          formData.append('birth_date', payload.user_info.birth_date);
        }

        formData.append(
          'document_type_id',
          payload.user_document.user_document_type_id
        );
        formData.append('document', payload.user_document.document);

        formData.append(
          'country_id',
          payload.user_address.country_id.toString()
        );
        formData.append('zip_code', payload.user_address.zip_code);
        formData.append('address1', payload.user_address.address1);
        if (payload.user_address.address2) {
          formData.append('address2', payload.user_address.address2);
        }
        if (payload.user_address.city_fiscal_code) {
          formData.append(
            'city_fiscal_code',
            payload.user_address.city_fiscal_code
          );
        }
        if (payload.user_address.state_fiscal_code) {
          formData.append(
            'state_fiscal_code',
            payload.user_address.state_fiscal_code
          );
        }
        formData.append('district', payload.user_address.district);

        if (photoFile instanceof File) {
          formData.append('photo', photoFile);
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.post<IApiResponse<boolean>>(
          `/user`,
          formData,
          config
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
      body: UpdateUserRequest,
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();

        if (body.email?.value !== undefined && body.email.value !== null) {
          formData.append('email', body.email.value);
        }
        if (
          body.password?.value !== undefined &&
          body.password.value !== null
        ) {
          formData.append('password', body.password.value);
        }
        if (
          body.account_id?.value !== undefined &&
          body.account_id.value !== null
        ) {
          formData.append('account_id', body.account_id.value);
        }
        if (
          body.user_status_id?.value !== undefined &&
          body.user_status_id.value !== null
        ) {
          formData.append('user_status_id', body.user_status_id.value);
        }
        if (
          body.phone_ddi?.value !== undefined &&
          body.phone_ddi.value !== null
        ) {
          formData.append('phone_ddi', body.phone_ddi.value);
        }
        if (body.phone?.value !== undefined && body.phone.value !== null) {
          formData.append('phone', body.phone.value);
        }
        if (body.name?.value !== undefined && body.name.value !== null) {
          formData.append('name', body.name.value);
        }
        if (
          body.last_name?.value !== undefined &&
          body.last_name.value !== null
        ) {
          formData.append('last_name', body.last_name.value);
        }
        if (
          body.birth_date?.value !== undefined &&
          body.birth_date.value !== null
        ) {
          formData.append('birth_date', body.birth_date.value);
        }
        if (
          body.document_type_id?.value !== undefined &&
          body.document_type_id.value !== null
        ) {
          formData.append('document_type_id', body.document_type_id.value);
        }
        if (
          body.document?.value !== undefined &&
          body.document.value !== null
        ) {
          formData.append('document', body.document.value);
        }
        if (
          body.country_id?.value !== undefined &&
          body.country_id.value !== null
        ) {
          formData.append('country_id', body.country_id.value.toString());
        }
        if (
          body.zip_code?.value !== undefined &&
          body.zip_code.value !== null
        ) {
          formData.append('zip_code', body.zip_code.value);
        }
        if (
          body.address1?.value !== undefined &&
          body.address1.value !== null
        ) {
          formData.append('address1', body.address1.value);
        }
        if (
          body.address2?.value !== undefined &&
          body.address2.value !== null
        ) {
          formData.append('address2', body.address2.value);
        }
        if (
          body.city_fiscal_code?.value !== undefined &&
          body.city_fiscal_code.value !== null
        ) {
          formData.append('city_fiscal_code', body.city_fiscal_code.value);
        }
        if (
          body.state_fiscal_code?.value !== undefined &&
          body.state_fiscal_code.value !== null
        ) {
          formData.append('state_fiscal_code', body.state_fiscal_code.value);
        }
        if (
          body.district?.value !== undefined &&
          body.district.value !== null
        ) {
          formData.append('district', body.district.value);
        }
        if (body.photo_url?.value !== undefined) {
          if (body.photo_url.value === null) {
            formData.append('photo_url', '');
          }
          if (body.photo_url.value !== null) {
            formData.append('photo_url', body.photo_url.value);
          }
        }
        if (photoFile instanceof File) {
          formData.append('photo', photoFile);
        }

        const config: AxiosRequestConfig<FormData> = {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        };

        const response = await axios.patch<IApiResponse<boolean>>(
          `/user/${payload.user_id}`,
          formData,
          config
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

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_role_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data.permission_role_id ?? null;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_role_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

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
