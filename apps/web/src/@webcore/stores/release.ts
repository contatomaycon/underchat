import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListReleaseFinalResponse,
  ListReleaseResponse,
} from '@core/schema/release/listRelease/response.schema';
import { ListReleaseRequest } from '@core/schema/release/listRelease/request.schema';
import { ViewReleaseResponse } from '@core/schema/release/viewRelease/response.schema';
import { CreateReleaseRequest } from '@core/schema/release/createRelease/request.schema';
import { CreateReleaseResponse } from '@core/schema/release/createRelease/response.schema';
import { ListReleaseUsersResponse } from '@core/schema/release/listReleaseUsers/response.schema';
import { ListReleaseAccountsResponse } from '@core/schema/release/listReleaseAccounts/response.schema';
import { ListReleasePermissionRolesResponse } from '@core/schema/release/listReleasePermissionRoles/response.schema';

export const useReleaseStore = defineStore('release', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListReleaseResponse[],
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
    async listReleases(
      input?: ListReleaseRequest
    ): Promise<ListReleaseFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListReleaseFinalResponse>
        >('/release', {
          params: input,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('release_list_not_found');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('release_list_not_found');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
    async viewRelease(releaseId: string): Promise<ViewReleaseResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewReleaseResponse>>(
          `/release/${releaseId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('release_not_found');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('release_not_found');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
    async createRelease(
      input: CreateReleaseRequest
    ): Promise<CreateReleaseResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<CreateReleaseResponse>>(
          '/release',
          input
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('release_create_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.showSnackbar(
          this.i18n.global.t('release_create_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('release_create_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },
    async listReleaseUsers(): Promise<ListReleaseUsersResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListReleaseUsersResponse>>(
            '/release/users'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        console.error('Error loading release users:', error);
        return null;
      }
    },
    async listReleaseAccounts(): Promise<ListReleaseAccountsResponse | null> {
      try {
        const response =
          await axios.get<IApiResponse<ListReleaseAccountsResponse>>(
            '/release/accounts'
          );

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        console.error('Error loading release accounts:', error);
        return null;
      }
    },
    async listReleasePermissionRoles(): Promise<ListReleasePermissionRolesResponse | null> {
      try {
        const response = await axios.get<
          IApiResponse<ListReleasePermissionRolesResponse>
        >('/release/permission-roles');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        return data.data;
      } catch (error) {
        console.error('Error loading release permission roles:', error);
        return null;
      }
    },
  },
});
