import { defineStore } from 'pinia';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { ListPermissionGroupsResponse } from '@core/schema/permission/listPermissionGroups/response.schema';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { EColor } from '@core/common/enums/EColor';
import { getI18n } from '@/plugins/i18n';
import { AxiosError } from 'axios';
import { PermissionGroupRequest } from '@core/schema/permission/updateRolePermissions/request.schema';
import { UpdateRolePermissionsResponse } from '@core/schema/permission/updateRolePermissions/response.schema';
import { ListPermissionRoleAccountResponse } from '@core/schema/permission/listPermissionRoleAccount/response.schema';

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    loading: false,
    i18n: getI18n(),
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
    async listPermissionGroupsByUser(): Promise<ListPermissionGroupsResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListPermissionGroupsResponse>
        >(`/permission/groups/user`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('permission_groups_load_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('permission_groups_load_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async listPermissionGroupsByPermissionRoleId(
      permissionRoleId: string
    ): Promise<ListPermissionGroupsResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListPermissionGroupsResponse>
        >(`/permission/groups/user/${permissionRoleId}`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('permission_groups_load_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('permission_groups_load_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async updateRolePermissions(
      permissionRoleId: string,
      groups: PermissionGroupRequest[]
    ): Promise<UpdateRolePermissionsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.put<
          IApiResponse<UpdateRolePermissionsResponse>
        >(`/permission/groups/user/${permissionRoleId}`, {
          groups,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('permission_groups_update_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('role_permissions_updated_successfully'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;

        let errorMessage = this.i18n.global.t('permission_groups_update_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
    async listPermissionRoleAccount(
      accountId: string
    ): Promise<ListPermissionRoleAccountResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListPermissionRoleAccountResponse>
        >(`/permission-role/account/${accountId}`);

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('permission_role_account_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('permission_role_account_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        return null;
      }
    },
  },
});
