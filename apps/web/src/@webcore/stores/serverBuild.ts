import { defineStore } from 'pinia';
import { AxiosError } from 'axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import { ISnackbar } from '@core/common/interfaces/ISnackbar';
import { EColor } from '@core/common/enums/EColor';
import { getI18n } from '@/plugins/i18n';
import axios from '@webcore/axios';
import {
  ServerBuildJob,
  ServerBuildVersion,
  ServerBuildViewResponse,
} from '@core/schema/server/viewServerBuild/response.schema';
import { ServerBuildGenerateResponse } from '@core/schema/server/generateServerBuild/response.schema';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';

type VersionsByType = Record<EServerBuildType, ServerBuildVersion[]>;

const emptyVersionsByType = (): VersionsByType => ({
  [EServerBuildType.baileys]: [],
  [EServerBuildType.wwebjs]: [],
  [EServerBuildType.balance_api]: [],
});

export const useServerBuildStore = defineStore('serverBuild', {
  state: () => ({
    snackbar: {
      color: EColor.success,
      message: '',
      status: false,
    } as ISnackbar,
    i18n: getI18n(),
    loading: false,
    active_job: null as ServerBuildJob | null,
    versions_by_type: emptyVersionsByType() as VersionsByType,
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

    async fetchBuilds(): Promise<ServerBuildViewResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.get<IApiResponse<ServerBuildViewResponse>>(
            '/server/build'
          );

        this.loading = false;

        const data = response.data;
        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_list_error'),
            EColor.error
          );
          return null;
        }

        this.active_job = data.data.active_job;
        this.versions_by_type = data.data.versions_by_type;
        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('build_list_error');
        if (error instanceof AxiosError) {
          message = error.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async generateVersion(): Promise<ServerBuildGenerateResponse | null> {
      try {
        this.loading = true;

        const response = await axios.post<
          IApiResponse<ServerBuildGenerateResponse>
        >('/server/build/generate');

        this.loading = false;

        const data = response.data;
        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_generate_error'),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_generate_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('build_generate_error');
        if (error instanceof AxiosError) {
          if (error.response?.status === 409) {
            message =
              error.response?.data?.message ??
              this.i18n.global.t('build_generate_conflict');
          } else {
            message = error.response?.data?.message ?? message;
          }
        }
        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return null;
      }
    },

    async cancelActiveBuild(): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<void>>(
          '/server/build/cancel'
        );

        this.loading = false;

        const data = response.data;
        if (!data?.status) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_cancel_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_cancel_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let message = this.i18n.global.t('build_cancel_error');
        if (error instanceof AxiosError) {
          message = error.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return false;
      }
    },

    async setDefaultVersion(serverBuildVersionId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.patch<IApiResponse<ServerBuildVersion>>(
          `/server/build/default/${serverBuildVersionId}`
        );

        this.loading = false;

        const data = response.data;
        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_set_default_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_set_default_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let message = this.i18n.global.t('build_set_default_error');
        if (error instanceof AxiosError) {
          message = error.response?.data?.message ?? message;
        }
        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return false;
      }
    },
  },
});
