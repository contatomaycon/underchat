import { defineStore } from 'pinia';
import axios from '@webcore/axios';
import { AxiosError } from 'axios';
import { getI18n } from '@/plugins/i18n';
import { EColor } from '@core/common/enums/EColor';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { ERandomMessageStatus } from '@core/common/enums/ERandomMessageStatus';
import {
  ListRandomMessageFinalResponse,
  ListRandomMessageResponse,
} from '@core/schema/randomMessage/listRandomMessage/response.schema';
import { ListRandomMessageRequest } from '@core/schema/randomMessage/listRandomMessage/request.schema';
import { ViewRandomMessageResponse } from '@core/schema/randomMessage/viewRandomMessage/response.schema';
import { CreateRandomMessageRequest } from '@core/schema/randomMessage/createRandomMessage/request.schema';
import {
  UpdateRandomMessageParams,
  UpdateRandomMessageRequest,
} from '@core/schema/randomMessage/updateRandomMessage/request.schema';
import {
  ListRandomMessageItemFinalResponse,
  ListRandomMessageItemResponse,
} from '@core/schema/randomMessage/listRandomMessageItem/response.schema';
import { ListRandomMessageItemQueryRequest } from '@core/schema/randomMessage/listRandomMessageItem/request.schema';
import { ViewRandomMessageItemResponse } from '@core/schema/randomMessage/viewRandomMessageItem/response.schema';
import {
  CreateRandomMessageItemParamsRequest,
  CreateRandomMessageItemRequest,
} from '@core/schema/randomMessage/createRandomMessageItem/request.schema';
import {
  UpdateRandomMessageItemParamsRequest,
  UpdateRandomMessageItemRequest,
} from '@core/schema/randomMessage/updateRandomMessageItem/request.schema';

interface IListRandomMessages {
  page?: number;
  per_page?: number;
  sort_by?: any[];
  search?: string | null;
  name?: string | null;
  status?: ERandomMessageStatus | null;
}

interface IListRandomMessageItems {
  page?: number;
  per_page?: number;
  sort_by?: any[];
  search?: string | null;
  message?: string | null;
  status?: ERandomMessageStatus | null;
}

export const useRandomMessageStore = defineStore('randomMessage', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListRandomMessageResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    itemList: [] as ListRandomMessageItemResponse[],
    itemPagings: {
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

    async listRandomMessages(
      input?: IListRandomMessages
    ): Promise<ListRandomMessageFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListRandomMessageRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              name: input.name ?? input.search,
              status: input.status,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListRandomMessageFinalResponse>
        >('/random-message', {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('random_message_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async getRandomMessageById(
      randomMessageId: string
    ): Promise<ViewRandomMessageResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewRandomMessageResponse>
        >(`/random-message/${randomMessageId}`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ?? this.i18n.global.t('random_message_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_view_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async addRandomMessage(
      payload: CreateRandomMessageRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<{ random_message_id: string }>
        >('/random-message', payload);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('random_message_add_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_add_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async updateRandomMessage(
      payload: UpdateRandomMessageParams,
      body: UpdateRandomMessageRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/random-message/${payload.random_message_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('random_message_edit_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_edit_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async deleteRandomMessage(randomMessageId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/random-message/${randomMessageId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ?? this.i18n.global.t('random_message_delete_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_delete_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async listRandomMessageItems(
      randomMessageId: string,
      input?: IListRandomMessageItems
    ): Promise<ListRandomMessageItemFinalResponse | null> {
      try {
        this.loading = true;

        const request: ListRandomMessageItemQueryRequest | undefined = input
          ? {
              current_page: input.page,
              per_page: input.per_page,
              sort_by: input.sort_by,
              message: input.message ?? input.search,
              status: input.status,
            }
          : undefined;

        const response = await axios.get<
          IApiResponse<ListRandomMessageItemFinalResponse>
        >(`/random-message/${randomMessageId}/messages`, {
          params: request,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('random_message_item_list_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        this.itemList = data.data.results;
        this.itemPagings = data.data.pagings;

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_item_list_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async getRandomMessageItemById(
      randomMessageId: string,
      randomMessageItemId: string
    ): Promise<ViewRandomMessageItemResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ViewRandomMessageItemResponse>
        >(`/random-message/${randomMessageId}/messages/${randomMessageItemId}`);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          const message =
            data?.message ??
            this.i18n.global.t('random_message_item_view_error');

          this.showSnackbar(message, EColor.error);

          return null;
        }

        return data.data;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_item_view_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return null;
      }
    },

    async addRandomMessageItem(
      payload: CreateRandomMessageItemParamsRequest,
      body: CreateRandomMessageItemRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<{ random_message_item_id: string }>
        >(`/random-message/${payload.random_message_id}/messages`, body);

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('random_message_item_add_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_item_add_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_item_add_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async updateRandomMessageItem(
      payload: UpdateRandomMessageItemParamsRequest,
      body: UpdateRandomMessageItemRequest
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<boolean>>(
          `/random-message/${payload.random_message_id}/messages/${payload.random_message_item_id}`,
          body
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('random_message_item_edit_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_item_edit_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t('random_message_item_edit_error');

        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }

        this.showSnackbar(errorMessage, EColor.error);
        this.loading = false;

        return false;
      }
    },

    async deleteRandomMessageItem(
      randomMessageId: string,
      randomMessageItemId: string
    ): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<IApiResponse<boolean>>(
          `/random-message/${randomMessageId}/messages/${randomMessageItemId}`
        );

        this.loading = false;

        const data = response?.data;

        if (!data?.status) {
          const message =
            data?.message ??
            this.i18n.global.t('random_message_item_delete_error');

          this.showSnackbar(message, EColor.error);

          return false;
        }

        this.showSnackbar(
          this.i18n.global.t('random_message_item_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let errorMessage = this.i18n.global.t(
          'random_message_item_delete_error'
        );

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
