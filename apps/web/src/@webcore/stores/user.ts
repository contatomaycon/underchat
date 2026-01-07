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
import { ListAllUsersResponse } from '@core/schema/user/listAllUsers/response.schema';
import { ListUserRolesResponse } from '@core/schema/user/listUserRoles/response.schema';
import { ListUserSectorsResponse } from '@core/schema/user/listUserSectors/response.schema';

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
              account_id: input.account_id,
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

    async listAllUsers(): Promise<ListAllUsersResponse[] | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListAllUsersResponse[]>>('/user/all');

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

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

    shouldAppendStringValue(
      field: { value?: string | null } | undefined
    ): boolean {
      return field?.value !== undefined && field.value !== null;
    },

    shouldAppendNumberValue(
      field: { value?: number | null } | undefined
    ): boolean {
      return field?.value !== undefined && field.value !== null;
    },

    appendStringField(
      formData: FormData,
      field: { value?: string | null } | undefined,
      fieldName: string
    ): void {
      if (field !== undefined) {
        const value = field?.value;
        if (value !== null && value !== undefined && value !== '') {
          formData.append(fieldName, value);
        } else if (value === null) {
          formData.append(fieldName, '');
        }
      }
    },

    appendNumberField(
      formData: FormData,
      field: { value?: number | null } | undefined,
      fieldName: string
    ): void {
      if (field !== undefined) {
        const value = field?.value;
        if (value !== null && value !== undefined) {
          formData.append(fieldName, value.toString());
        } else {
          formData.append(fieldName, '');
        }
      }
    },

    buildUpdateUserFormData(
      body: UpdateUserRequest,
      photoFile?: File | null
    ): FormData {
      const formData = new FormData();

      this.appendStringField(formData, body.email, 'email');
      this.appendStringField(formData, body.password, 'password');
      this.appendStringField(formData, body.account_id, 'account_id');
      this.appendStringField(formData, body.user_status_id, 'user_status_id');
      this.appendStringField(formData, body.phone_ddi, 'phone_ddi');
      this.appendStringField(formData, body.phone, 'phone');
      this.appendStringField(formData, body.name, 'name');
      this.appendStringField(formData, body.last_name, 'last_name');
      this.appendStringField(formData, body.birth_date, 'birth_date');
      this.appendStringField(
        formData,
        body.document_type_id,
        'document_type_id'
      );
      this.appendStringField(formData, body.document, 'document');
      this.appendNumberField(formData, body.country_id, 'country_id');
      this.appendStringField(formData, body.zip_code, 'zip_code');
      this.appendStringField(formData, body.address1, 'address1');
      this.appendStringField(formData, body.address2, 'address2');
      this.appendStringField(
        formData,
        body.city_fiscal_code,
        'city_fiscal_code'
      );
      this.appendStringField(
        formData,
        body.state_fiscal_code,
        'state_fiscal_code'
      );
      this.appendStringField(formData, body.district, 'district');

      if (body.permission_role_id !== undefined) {
        const permissionRoleIdValue = body.permission_role_id.value;
        if (permissionRoleIdValue) {
          formData.append('permission_role_id', permissionRoleIdValue);
        } else {
          formData.append('permission_role_id', '');
        }
      }

      if (body.photo_url?.value !== undefined) {
        formData.append('photo_url', body.photo_url.value ?? '');
      }
      if (photoFile instanceof File) {
        formData.append('photo', photoFile);
      }

      return formData;
    },

    async addUser(
      payload: {
        email: { value: string };
        password: { value: string };
        account_id?: { value: string };
        permission_role_id?: { value: string };
        phone_ddi?: { value: string };
        phone?: { value: string };
        name: { value: string };
        last_name: { value: string };
        birth_date?: { value: string | null };
        document_type_id?: { value: string };
        document?: { value: string };
        country_id?: { value: number };
        zip_code?: { value: string };
        address1?: { value: string };
        address2?: { value: string | null };
        city_fiscal_code?: { value: string | null };
        state_fiscal_code?: { value: string | null };
        district?: { value: string };
      },
      photoFile?: File | null
    ): Promise<boolean> {
      try {
        this.loading = true;

        const formData = new FormData();

        formData.append('email', payload.email.value);
        formData.append('password', payload.password.value);

        this.appendStringField(formData, payload.account_id, 'account_id');
        this.appendStringField(
          formData,
          payload.permission_role_id,
          'permission_role_id'
        );
        this.appendStringField(formData, payload.phone_ddi, 'phone_ddi');
        this.appendStringField(formData, payload.phone, 'phone');
        formData.append('name', payload.name.value);
        formData.append('last_name', payload.last_name.value);
        this.appendStringField(formData, payload.birth_date, 'birth_date');
        this.appendStringField(
          formData,
          payload.document_type_id,
          'document_type_id'
        );
        this.appendStringField(formData, payload.document, 'document');
        this.appendNumberField(formData, payload.country_id, 'country_id');
        this.appendStringField(formData, payload.zip_code, 'zip_code');
        this.appendStringField(formData, payload.address1, 'address1');
        this.appendStringField(formData, payload.address2, 'address2');
        this.appendStringField(
          formData,
          payload.city_fiscal_code,
          'city_fiscal_code'
        );
        this.appendStringField(
          formData,
          payload.state_fiscal_code,
          'state_fiscal_code'
        );
        this.appendStringField(formData, payload.district, 'district');

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

        const formData = this.buildUpdateUserFormData(body, photoFile);

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

    async listUserRoles(): Promise<ListUserRolesResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListUserRolesResponse>>(`/user/roles`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('user_roles_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_roles_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listUserSectors(): Promise<ListUserSectorsResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListUserSectorsResponse>>(
            `/user/sectors`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_sectors_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_sectors_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listUserSectorsByUserId(userId: string): Promise<string[] | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<string[]>>(
          `/user/${userId}/sectors`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('user_sectors_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('user_sectors_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
  },
});
