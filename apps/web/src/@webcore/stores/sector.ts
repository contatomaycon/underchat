import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListSectorFinalResponse,
  ListSectorResponse,
} from '@core/schema/sector/listSector/response.schema';
import { IListSectors } from '../interfaces/IListSectors';
import { ListSectorRequest } from '@core/schema/sector/listSector/request.schema';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { CreateSectorResponse } from '@core/schema/sector/createSector/response.schema';
import {
  EditSectorParamsBody,
  EditSectorParamsRequest,
} from '@core/schema/sector/editSector/request.schema';
import { ViewSectorResponse } from '@core/schema/sector/viewSector/response.schema';

export const useSectorsStore = defineStore('sectors', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListSectorResponse[],
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
    async listSectors(
      input?: IListSectors
    ): Promise<ListSectorFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListSectorRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.search,
              sector_status: input.search,
              color: input.search,
              account: input.search,
            }
          : undefined;

        const response = await axios.get<IApiResponse<ListSectorFinalResponse>>(
          `/sector`,
          {
            params: request,
          }
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('sector_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('sector_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addSectors(payload: CreateSectorRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<CreateSectorResponse>>(
          `/sector`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('sector_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('sector_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('sector_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateSector(
      payload: EditSectorParamsRequest,
      body: EditSectorParamsBody
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/sector/${payload.sector_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('sector_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('sector_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('sector_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async getSectorById(sectorId: string): Promise<ViewSectorResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewSectorResponse>>(
          `/sector/${sectorId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('sector_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('sector_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async deleteSector(sectorId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/sector/${sectorId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('sector_deleted_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('sector_deleted_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('sector_deleted_error');
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
