import { defineStore } from 'pinia';
import { AxiosError } from 'axios';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { EColor } from '@core/common/enums/EColor';
import { PagingResponseSchema } from '@core/schema/common/pagingResponseSchema';
import { getI18n } from '@/plugins/i18n';
import {
  ListWarmChannelsFinalResponse,
  ListWarmChannelsResponse,
} from '@core/schema/config/listWarmChannels/response.schema';
import { ListWarmChannelsRequest } from '@core/schema/config/listWarmChannels/request.schema';
import { ListWarmChannelServersResponse } from '@core/schema/config/listWarmChannelServers/response.schema';
import { RecreateWarmChannelsAllRequest } from '@core/schema/config/recreateWarmChannelsAll/request.schema';
import { WarmChannelSettingsResponse } from '@core/schema/config/viewWarmChannelSettings/response.schema';
import { UpdateWarmChannelSettingsRequest } from '@core/schema/config/updateWarmChannelSettings/request.schema';

interface RecreateWarmChannelsResponse {
  enqueued: number;
}

export const useWarmChannelsStore = defineStore('warmChannels', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    list: [] as ListWarmChannelsResponse[],
    pagings: {
      current_page: 1 as number,
      total_pages: 1 as number,
      per_page: 10 as number,
      count: 0 as number,
      total: 0 as number,
    } as PagingResponseSchema,
    servers: [] as ListWarmChannelServersResponse['results'],
    settings: null as WarmChannelSettingsResponse | null,
    settingsLoading: false,
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
    async listWarmChannels(
      query: ListWarmChannelsRequest
    ): Promise<ListWarmChannelsFinalResponse | null> {
      try {
        this.loading = true;

        const response = await axios.get<
          IApiResponse<ListWarmChannelsFinalResponse>
        >('/config/warm-channels', {
          params: query,
        });

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('warm_channels_list_error'),
            EColor.error
          );
          return null;
        }

        this.list = data.data.results;
        this.pagings = data.data.pagings;

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t('warm_channels_list_error');
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async listWarmChannelServers(): Promise<
      ListWarmChannelServersResponse['results'] | null
    > {
      try {
        const response = await axios.get<
          IApiResponse<ListWarmChannelServersResponse>
        >('/config/warm-channels/servers');

        const data = response?.data;

        if (!data?.status || !data?.data) {
          return null;
        }

        this.servers = data.data.results;

        return data.data.results;
      } catch {
        return null;
      }
    },
    async viewWarmChannelSettings(): Promise<WarmChannelSettingsResponse | null> {
      try {
        this.settingsLoading = true;

        const response = await axios.get<
          IApiResponse<WarmChannelSettingsResponse>
        >('/config/warm-channels/settings');

        this.settingsLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ??
              this.i18n.global.t('warm_channel_settings_view_error'),
            EColor.error
          );
          return null;
        }

        this.settings = data.data;

        return data.data;
      } catch (error) {
        this.settingsLoading = false;
        let errorMessage = this.i18n.global.t(
          'warm_channel_settings_view_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async updateWarmChannelSettings(
      payload: UpdateWarmChannelSettingsRequest
    ): Promise<WarmChannelSettingsResponse | null> {
      try {
        this.settingsLoading = true;

        const response = await axios.patch<
          IApiResponse<WarmChannelSettingsResponse>
        >('/config/warm-channels/settings', payload);

        this.settingsLoading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ??
              this.i18n.global.t('warm_channel_settings_update_error'),
            EColor.error
          );
          return null;
        }

        this.settings = data.data;
        this.showSnackbar(
          data.message ??
            this.i18n.global.t('warm_channel_settings_update_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.settingsLoading = false;
        let errorMessage = this.i18n.global.t(
          'warm_channel_settings_update_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
    async recreateWarmChannelsAll(
      filters: RecreateWarmChannelsAllRequest
    ): Promise<RecreateWarmChannelsResponse | null> {
      try {
        this.loading = true;

        const response = await axios.patch<
          IApiResponse<RecreateWarmChannelsResponse>
        >('/config/warm-channels/recreate-all', filters);

        this.loading = false;

        const data = response?.data;

        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ??
              this.i18n.global.t('warm_channels_recreate_all_error'),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          data.message ??
            this.i18n.global.t('warm_channels_recreate_all_enqueued', {
              count: data.data.enqueued,
            }),
          EColor.success
        );

        return data.data;
      } catch (error) {
        this.loading = false;
        let errorMessage = this.i18n.global.t(
          'warm_channels_recreate_all_error'
        );
        if (error instanceof AxiosError) {
          errorMessage = error?.response?.data?.message ?? errorMessage;
        }
        this.showSnackbar(errorMessage, EColor.error);
        return null;
      }
    },
  },
});
