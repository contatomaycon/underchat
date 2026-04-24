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
import { PairServerBuildResponse } from '@core/schema/server/pairServerBuild/response.schema';
import { DeleteServerBuildResponse } from '@core/schema/server/deleteServerBuild/response.schema';
import { RetryServerBuildRequest } from '@core/schema/server/retryServerBuild/request.schema';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { IServerBuildCentrifugo } from '@core/common/interfaces/IServerBuildCentrifugo';

type VersionsByType = Record<EServerBuildType, ServerBuildVersion[]>;
type RealtimeLogsByJob = Record<string, string[]>;

const emptyVersionsByType = (): VersionsByType => ({
  [EServerBuildType.baileys]: [],
  [EServerBuildType.wwebjs]: [],
  [EServerBuildType.whatsmeow]: [],
  [EServerBuildType.balance_api]: [],
});

const activeJobStatuses = new Set<EServerBuildJobStatus>([
  EServerBuildJobStatus.queued,
  EServerBuildJobStatus.running,
  EServerBuildJobStatus.cancel_requested,
]);

const realtimeLogsLimitPerJob = 1000;

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
    jobs: [] as ServerBuildJob[],
    versions_by_type: emptyVersionsByType() as VersionsByType,
    realtime_logs_by_job: {} as RealtimeLogsByJob,
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

    syncActiveJobFromJobs() {
      const activeJob =
        this.jobs.find((job) =>
          activeJobStatuses.has(job.status as EServerBuildJobStatus)
        ) ?? null;

      this.active_job = activeJob;
    },

    upsertJob(job: ServerBuildJob) {
      const index = this.jobs.findIndex(
        (current) => current.server_build_job_id === job.server_build_job_id
      );

      if (index === -1) {
        this.jobs = [job, ...this.jobs];
      } else {
        const nextJobs = [...this.jobs];
        nextJobs[index] = job;
        this.jobs = nextJobs;
      }

      this.jobs = [...this.jobs]
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at))
        )
        .slice(0, 20);

      const validJobIds = new Set(
        this.jobs.map((currentJob) => currentJob.server_build_job_id)
      );
      this.realtime_logs_by_job = Object.fromEntries(
        Object.entries(this.realtime_logs_by_job).filter(([jobId]) =>
          validJobIds.has(jobId)
        )
      );

      this.syncActiveJobFromJobs();
    },

    appendRealtimeLog(
      serverBuildJobId: string,
      inputLog: string,
      buildType: string | null,
      stream: string | null,
      timestamp: string
    ) {
      const normalizedLines = inputLog
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (normalizedLines.length === 0) {
        return;
      }

      const prefix = [
        `[${timestamp || new Date().toISOString()}]`,
        buildType ? `[${buildType}]` : null,
        stream ? `[${stream}]` : null,
      ]
        .filter(Boolean)
        .join(' ');

      const currentLogs = this.realtime_logs_by_job[serverBuildJobId] ?? [];
      const nextLogs = [
        ...currentLogs,
        ...normalizedLines.map((line) => `${prefix} ${line}`),
      ].slice(-realtimeLogsLimitPerJob);

      this.realtime_logs_by_job = {
        ...this.realtime_logs_by_job,
        [serverBuildJobId]: nextLogs,
      };
    },

    applyRealtimeEvent(event: IServerBuildCentrifugo) {
      if (!event?.server_build_job_id) {
        return;
      }

      if (event.event === 'job_snapshot' && event.job) {
        this.upsertJob(event.job);
        return;
      }

      if (event.event === 'command_log' && event.log) {
        this.appendRealtimeLog(
          event.server_build_job_id,
          event.log,
          event.build_type,
          event.stream,
          event.timestamp
        );
      }
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

        this.jobs = data.data.jobs ?? [];
        this.syncActiveJobFromJobs();
        this.active_job = data.data.active_job;
        this.versions_by_type = data.data.versions_by_type;

        const validJobIds = new Set(
          this.jobs.map((job) => job.server_build_job_id)
        );
        this.realtime_logs_by_job = Object.fromEntries(
          Object.entries(this.realtime_logs_by_job).filter(([jobId]) =>
            validJobIds.has(jobId)
          )
        );

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

    async pairBuilds(): Promise<PairServerBuildResponse | null> {
      try {
        this.loading = true;

        const response =
          await axios.post<IApiResponse<PairServerBuildResponse>>(
            '/server/build/pair'
          );

        this.loading = false;

        const data = response.data;
        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_pair_error'),
            EColor.error
          );
          return null;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_pair_success'),
          EColor.success
        );

        return data.data;
      } catch (error) {
        let message = this.i18n.global.t('build_pair_error');
        if (error instanceof AxiosError) {
          message = error.response?.data?.message ?? message;
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

    async retryBuildItem(input: RetryServerBuildRequest): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.post<IApiResponse<void>>(
          '/server/build/retry',
          input
        );

        this.loading = false;

        const data = response.data;
        if (!data?.status) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_retry_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_retry_success'),
          EColor.success
        );
        return true;
      } catch (error) {
        let message = this.i18n.global.t('build_retry_error');
        if (error instanceof AxiosError) {
          message = error.response?.data?.message ?? message;
        }

        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return false;
      }
    },

    async deleteBuild(serverBuildJobId: string): Promise<boolean> {
      try {
        this.loading = true;

        const response = await axios.delete<
          IApiResponse<DeleteServerBuildResponse>
        >(`/server/build/${serverBuildJobId}`);

        this.loading = false;

        const data = response.data;
        if (!data?.status || !data?.data) {
          this.showSnackbar(
            data?.message ?? this.i18n.global.t('build_delete_error'),
            EColor.error
          );
          return false;
        }

        this.showSnackbar(
          data.message ?? this.i18n.global.t('build_delete_success'),
          EColor.success
        );

        return true;
      } catch (error) {
        let message = this.i18n.global.t('build_delete_error');
        if (error instanceof AxiosError) {
          if (error.response?.status === 409) {
            message =
              error.response?.data?.message ??
              this.i18n.global.t('build_delete_conflict');
          } else {
            message = error.response?.data?.message ?? message;
          }
        }

        this.showSnackbar(message, EColor.error);
        this.loading = false;
        return false;
      }
    },
  },
});
