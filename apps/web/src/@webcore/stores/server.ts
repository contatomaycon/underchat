import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import {
  ListServerFinalResponse,
  ListServerResponse,
} from '@core/schema/server/listServer/response.schema';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { IListServers } from '@webcore/interfaces/IListServers';
import { ListServerRequest } from '@core/schema/server/listServer/request.schema';
import { ViewServerResponse } from '@core/schema/server/viewServer/response.schema';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
import { AxiosError } from 'axios';
import { CreateServerRequest } from '@core/schema/server/createServer/request.schema';
import { CreateServerResponse } from '@core/schema/server/createServer/response.schema';

export const useServerStore = defineStore('server', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list_servers: [] as ListServerResponse[],
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
    async listServers(
      input?: IListServers
    ): Promise<ListServerFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListServerRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              server_name: input.search,
              server_status_id: input.status,
              ssh_ip: input.search,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListServerFinalResponse>>(
          `/server`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('server_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list_servers = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('server_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async deleteServer(serverId: number): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<void>>(
          `/server/${serverId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('server_delete_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('server_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('server_delete_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getServerById(serverId: number): Promise<ViewServerResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewServerResponse>>(
          `/server/${serverId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('server_get_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('server_get_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async updateServer(
      serverId: number,
      payload: EditServerRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.put<IApiResponse<void>>(
          `/server/${serverId}`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('server_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('server_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('server_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async addServer(payload: CreateServerRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<CreateServerResponse>>(
          `/server`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('server_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('server_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('server_add_error');
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
