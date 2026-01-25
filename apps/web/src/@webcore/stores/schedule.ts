import { defineStore } from 'pinia';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import {
  ListScheduleFinalResponse,
  ListScheduleResponse,
} from '@core/schema/schedule/listSchedule/response.schema';
import { ListScheduleRequest } from '@core/schema/schedule/listSchedule/request.schema';
import { IListSchedules } from '@webcore/stores/interfaces/IListSchedules';
import { ViewScheduleResponse } from '@core/schema/schedule/viewSchedule/response.schema';
import { CreateScheduleRequest } from '@core/schema/schedule/createSchedule/request.schema';
import {
  EditScheduleParamsRequest,
  UpdateScheduleRequest,
} from '@core/schema/schedule/editSchedule/request.schema';
import { ListScheduleWorkersFinalResponse } from '@core/schema/schedule/listScheduleWorkers/response.schema';
import { ListScheduleChatbotsFinalResponse } from '@core/schema/schedule/listScheduleChatbots/response.schema';
import { ListScheduleContactsFinalResponse } from '@core/schema/schedule/listScheduleContacts/response.schema';
import { ListScheduleContactGroupsFinalResponse } from '@core/schema/schedule/listScheduleContactGroups/response.schema';
import { ListScheduleContactsRequest } from '@core/schema/schedule/listScheduleContacts/request.schema';
import { ListScheduleMessagesResponse } from '@core/schema/schedule/listScheduleMessages/response.schema';
import { ListScheduleMessagesRequest } from '@core/schema/schedule/listScheduleMessages/request.schema';

export const useScheduleStore = defineStore('schedule', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListScheduleResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    workers: [] as ListScheduleWorkersFinalResponse,
    contacts: [] as ListScheduleContactsFinalResponse['results'],
    contactGroups: [] as ListScheduleContactGroupsFinalResponse,
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

    async listSchedule(
      input?: IListSchedules
    ): Promise<ListScheduleFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListScheduleRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              search: input.search,
              type: input.type || undefined,
              send_to: input.send_to || undefined,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListScheduleFinalResponse>
        >(`/schedule`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async getScheduleById(
      scheduleId: string
    ): Promise<ViewScheduleResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<IApiResponse<ViewScheduleResponse>>(
          `/schedule/${scheduleId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_view_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_view_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async addSchedule(payload: CreateScheduleRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<boolean>>(
          `/schedule`,
          payload
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_add_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('schedule_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_add_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async updateSchedule(
      payload: EditScheduleParamsRequest,
      body: UpdateScheduleRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/schedule/${payload.schedule_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_edit_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('schedule_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_edit_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async deleteSchedule(scheduleId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/schedule/${scheduleId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_deleted_error');

          this.showSnackbar(mensage, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('schedule_deleted_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_deleted_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return false;
      }
    },

    async listScheduleWorkers(): Promise<ListScheduleWorkersFinalResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListScheduleWorkersFinalResponse>>(
            `/schedule/workers`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_workers_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.workers = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_workers_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listScheduleChatbots(): Promise<ListScheduleChatbotsFinalResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ListScheduleChatbotsFinalResponse>>(
            `/schedule/chatbots`
          );

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_chatbots_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_chatbots_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listScheduleContacts(
      page: number = 1,
      perPage: number = 10,
      search?: string
    ): Promise<ListScheduleContactsFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListScheduleContactsRequest = {
          current_page: page,
          per_page: perPage,
          search: search || null,
        };

        const response = await axios.get<
          IApiResponse<ListScheduleContactsFinalResponse>
        >(`/schedule/contacts`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_contacts_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.contacts = data.data.results;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_contacts_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listScheduleContactGroups(): Promise<ListScheduleContactGroupsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListScheduleContactGroupsFinalResponse>
        >(`/schedule/contact-groups`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ??
            this.i18n.global.t('schedule_contact_groups_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        this.contactGroups = data.data;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'schedule_contact_groups_list_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);

        this.loading = false;

        return null;
      }
    },

    async listScheduleMessages(
      scheduleId: string,
      page: number = 1,
      perPage: number = 50
    ): Promise<ListScheduleMessagesResponse | null> {
      try {
        this.loading = true;

        const request: ListScheduleMessagesRequest = {
          schedule_id: scheduleId,
          current_page: page,
          per_page: perPage,
        };

        const response = await axios.get<
          IApiResponse<ListScheduleMessagesResponse>
        >(`/schedule/messages`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const mensage =
            data?.message ?? this.i18n.global.t('schedule_messages_list_error');

          this.showSnackbar(mensage, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('schedule_messages_list_error');
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
