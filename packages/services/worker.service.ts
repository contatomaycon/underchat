import { injectable, inject } from 'tsyringe';
import Docker from 'dockerode';
import { EWorkerImage } from '@core/common/enums/EWorkerImage';
import { WorkerCreatorRepository } from '@core/repositories/worker/WorkerCreator.repository';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { WorkerServerListerRepository } from '@core/repositories/worker/WorkerServerLister.repository';
import { WorkerServerViewerRepository } from '@core/repositories/worker/WorkerServerViewer.repository';
import { WorkerTotalViewerRepository } from '@core/repositories/worker/WorkerTotalViewer.repository';
import { WorkerListerRepository } from '@core/repositories/worker/WorkerLister.repository';
import { ListWorkerRequest } from '@core/schema/worker/listWorker/request.schema';
import { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import {
  WorkerLifecycleUpdateGuard,
  WorkerUpdaterRepository,
} from '@core/repositories/worker/WorkerUpdater.repository';
import { WorkerViewerRepository } from '@core/repositories/worker/WorkerViewer.repository';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { WorkerNameAndContainerIdViewerRepository } from '@core/repositories/worker/WorkerNameAndContainerIdViewer.repository';
import { WorkerViewerExistsRepository } from '@core/repositories/worker/WorkerViewerExists.repository';
import { WorkerBalancerViewerRepository } from '@core/repositories/worker/WorkerBalancerViewer.repository';
import { WorkerDeleterRepository } from '@core/repositories/worker/WorkerDeleter.repository';
import { WorkerPhoneConnectionDateViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionDateViewer.repository';
import { IViewWorkerPhoneConnectionDate } from '@core/common/interfaces/IViewWorkerPhoneConnectionDate';
import { WorkerPhoneStatusConnectionDateUpdaterRepository } from '@core/repositories/worker/WorkerPhoneStatusConnectionDateUpdater.repository';
import { IUpdateWorkerPhoneStatusConnectionDate } from '@core/common/interfaces/IUpdateWorkerPhoneStatusConnectionDate';
import { WorkerPhoneConnectionViewerRepository } from '@core/repositories/worker/WorkerPhoneConnectionViewer.repository';
import { IViewWorkerPhoneConnection } from '@core/common/interfaces/IViewWorkerPhoneConnection';
import { WorkerPhoneConnectionUpdaterRepository } from '@core/repositories/worker/WorkerPhoneConnectionUpdater.repository';
import { IUpdateWorkerPhoneConnection } from '@core/common/interfaces/IUpdateWorkerPhoneConnection';
import { WorkerPhoneConnectionCreatorRepository } from '@core/repositories/worker/WorkerPhoneConnectionCreator.repository';
import { ICreateWorkerPhoneConnection } from '@core/common/interfaces/ICreateWorkerPhoneConnection';
import { WorkerTypeViewerRepository } from '@core/repositories/worker/WorkerTypeViewer.repository';
import { IViewWorkerType } from '@core/common/interfaces/IViewWorkerType';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { IListWorkerServer } from '@core/common/interfaces/IListWorkerServer';
import { IViewWorkerServer } from '@core/common/interfaces/IViewWorkerServer';
import { WorkerBaileysActivitiesListerRepository } from '@core/repositories/worker/WorkerBaileysActivitiesLister.repository';
import { IListWorkerActivities } from '@core/common/interfaces/IListWorkerActivities';
import { WorkerStatusUpdaterRepository } from '@core/repositories/worker/WorkerStatusUpdater.repository';
import { WorkerNewStatusListerRepository } from '@core/repositories/worker/WorkerNewStatusLister.repository';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IViewWorkerNameAndContainerId } from '@core/common/interfaces/IViewWorkerNameAndContainerId';
import { WorkerNameAndIdViewerRepository } from '@core/repositories/worker/WorkerNameAndIdViewer.repository';
import { IViewWorkerNameAndId } from '@core/common/interfaces/IViewWorkerNameAndId';
import { WorkerConfigFieldsViewerRepository } from '@core/repositories/worker/WorkerConfigFieldsViewer.repository';
import { IWorkerConfigFields } from '@core/common/interfaces/IWorkerConfigFields';
import { WorkerAllListerRepository } from '@core/repositories/worker/WorkerAllLister.repository';
import { WorkerMonitorViewerRepository } from '@core/repositories/worker/WorkerMonitorViewer.repository';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import { TransferWorker } from '@core/schema/chat/listTransferOptions/response.schema';
import { WorkerUpdatedAtUpdaterRepository } from '@core/repositories/worker/WorkerUpdatedAtUpdater.repository';
import { WorkerLastConnectionCheckUpdaterRepository } from '@core/repositories/worker/WorkerLastConnectionCheckUpdater.repository';
import Redis from 'ioredis';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

export interface WorkerContainerInspection {
  exists: boolean;
  container_id?: string;
  container_name?: string;
  container_image?: string;
  container_image_id?: string;
  container_state?: string;
  container_status?: string;
  container_started_at?: string;
  container_finished_at?: string;
  container_restart_count?: number;
  container_exit_code?: number;
  container_health_status?: string;
  container_health_failing_streak?: number;
  container_health_log?: string;
  container_labels?: Record<string, string>;
  container_env?: Record<string, string>;
  running?: boolean;
  error?: string;
}

export interface WorkerContainerMetadata {
  workerTypeId?: string;
  workerGrpcPort?: number;
}

function dockerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@injectable()
export class WorkerService {
  private readonly docker: Docker;
  private readonly ignoredInheritedEnvKeys = new Set<string>([
    'PWD',
    'OLDPWD',
    'SHLVL',
    '_',
    'PUPPETEER_EXECUTABLE_PATH',
    'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD',
    'CHROME_BIN',
    'CHROME_PATH',
    'NODE_EXTRA_CA_CERTS',
  ]);
  private readonly inspectedEnvKeys = new Set<string>([
    'WORKER_ID',
    'ACCOUNT_ID',
    'WORKER_TYPE_ID',
    'WORKER_IMAGE',
    'WORKER_GRPC_PORT',
    'BALANCER_GRPC_HOST',
    'BALANCER_GRPC_PORT',
    'OTEL_SERVICE_NAME',
  ]);
  private readonly inspectedLabelKeys = new Set<string>([
    'underchat.worker_id',
    'underchat.account_id',
    'underchat.worker_type_id',
    'underchat.worker_image',
    'underchat.worker_grpc_port',
  ]);

  constructor(
    @inject(WorkerCreatorRepository)
    private readonly workerCreatorRepository: WorkerCreatorRepository,
    @inject(WorkerServerListerRepository)
    private readonly workerServerListerRepository: WorkerServerListerRepository,
    @inject(WorkerServerViewerRepository)
    private readonly workerServerViewerRepository: WorkerServerViewerRepository,
    @inject(WorkerTotalViewerRepository)
    private readonly workerTotalViewerRepository: WorkerTotalViewerRepository,
    @inject(WorkerListerRepository)
    private readonly workerListerRepository: WorkerListerRepository,
    @inject(WorkerUpdaterRepository)
    private readonly workerUpdaterRepository: WorkerUpdaterRepository,
    @inject(WorkerViewerRepository)
    private readonly workerViewerRepository: WorkerViewerRepository,
    @inject(WorkerNameAndContainerIdViewerRepository)
    private readonly workerNameAndContainerIdViewerRepository: WorkerNameAndContainerIdViewerRepository,
    @inject(WorkerViewerExistsRepository)
    private readonly workerViewerExistsRepository: WorkerViewerExistsRepository,
    @inject(WorkerBalancerViewerRepository)
    private readonly workerBalancerViewerRepository: WorkerBalancerViewerRepository,
    @inject(WorkerDeleterRepository)
    private readonly workerDeleterRepository: WorkerDeleterRepository,
    @inject(WorkerPhoneConnectionDateViewerRepository)
    private readonly workerPhoneConnectionDateViewerRepository: WorkerPhoneConnectionDateViewerRepository,
    @inject(WorkerPhoneStatusConnectionDateUpdaterRepository)
    private readonly workerPhoneStatusConnectionDateUpdaterRepository: WorkerPhoneStatusConnectionDateUpdaterRepository,
    @inject(WorkerPhoneConnectionViewerRepository)
    private readonly workerPhoneConnectionViewerRepository: WorkerPhoneConnectionViewerRepository,
    @inject(WorkerPhoneConnectionUpdaterRepository)
    private readonly workerPhoneConnectionUpdaterRepository: WorkerPhoneConnectionUpdaterRepository,
    @inject(WorkerPhoneConnectionCreatorRepository)
    private readonly workerPhoneConnectionCreatorRepository: WorkerPhoneConnectionCreatorRepository,
    @inject(WorkerTypeViewerRepository)
    private readonly workerTypeViewerRepository: WorkerTypeViewerRepository,
    @inject(WorkerBaileysActivitiesListerRepository)
    private readonly workerBaileysActivitiesListerRepository: WorkerBaileysActivitiesListerRepository,
    @inject(WorkerNewStatusListerRepository)
    private readonly workerNewStatusListerRepository: WorkerNewStatusListerRepository,
    @inject(WorkerStatusUpdaterRepository)
    private readonly workerStatusUpdaterRepository: WorkerStatusUpdaterRepository,
    @inject(WorkerNameAndIdViewerRepository)
    private readonly workerNameAndIdViewerRepository: WorkerNameAndIdViewerRepository,
    @inject(WorkerConfigFieldsViewerRepository)
    private readonly workerConfigFieldsViewerRepository: WorkerConfigFieldsViewerRepository,
    @inject(WorkerAllListerRepository)
    private readonly workerAllListerRepository: WorkerAllListerRepository,
    @inject(WorkerMonitorViewerRepository)
    private readonly workerMonitorViewerRepository: WorkerMonitorViewerRepository,
    @inject(WorkerUpdatedAtUpdaterRepository)
    private readonly workerUpdatedAtUpdaterRepository: WorkerUpdatedAtUpdaterRepository,
    @inject(WorkerLastConnectionCheckUpdaterRepository)
    private readonly workerLastConnectionCheckUpdaterRepository: WorkerLastConnectionCheckUpdaterRepository,
    @inject('Redis') private readonly redis: Redis
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  private buildContainerEnv(overrides: string[]): string[] {
    const envMap = new Map<string, string>();

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) {
        continue;
      }

      if (!/^[A-Z0-9_]+$/.test(key)) {
        continue;
      }

      if (this.ignoredInheritedEnvKeys.has(key)) {
        continue;
      }

      if (key.startsWith('npm_') || key.startsWith('PNPM_')) {
        continue;
      }

      envMap.set(key, value);
    }

    for (const envEntry of overrides) {
      const separatorIndex = envEntry.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = envEntry.slice(0, separatorIndex);
      const value = envEntry.slice(separatorIndex + 1);
      envMap.set(key, value);
    }

    return [...envMap.entries()].map(([key, value]) => `${key}=${value}`);
  }

  private buildContainerLabels(input: {
    imageName: EWorkerImage;
    workerId: string;
    accountId: string;
    metadata?: WorkerContainerMetadata;
  }): Record<string, string> {
    return {
      'underchat.worker_id': input.workerId,
      'underchat.account_id': input.accountId,
      'underchat.worker_image': input.imageName,
      ...(input.metadata?.workerTypeId
        ? { 'underchat.worker_type_id': input.metadata.workerTypeId }
        : {}),
      ...(input.metadata?.workerGrpcPort !== undefined
        ? {
            'underchat.worker_grpc_port': String(input.metadata.workerGrpcPort),
          }
        : {}),
    };
  }

  private getAllowedLabels(
    labels: Record<string, string> | undefined
  ): Record<string, string> {
    const safeLabels: Record<string, string> = {};

    for (const [key, value] of Object.entries(labels ?? {})) {
      if (this.inspectedLabelKeys.has(key)) {
        safeLabels[key] = value;
      }
    }

    return safeLabels;
  }

  private getAllowedEnv(env: string[] | undefined): Record<string, string> {
    const safeEnv: Record<string, string> = {};

    for (const envEntry of env ?? []) {
      const separatorIndex = envEntry.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = envEntry.slice(0, separatorIndex);
      if (!this.inspectedEnvKeys.has(key)) {
        continue;
      }

      safeEnv[key] = envEntry.slice(separatorIndex + 1);
    }

    return safeEnv;
  }

  private sanitizeDiagnosticText(
    value: string | undefined
  ): string | undefined {
    const normalized = value
      ?.replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .replace(
        /([A-Z0-9_]*(?:PASSWORD|TOKEN|SECRET|KEY)[A-Z0-9_]*=)[^ ]+/giu,
        '$1[redacted]'
      )
      .trim();

    if (!normalized) {
      return undefined;
    }

    return normalized.length > 4000
      ? `${normalized.slice(0, 4000)}...`
      : normalized;
  }

  public async existsContainerWorkerById(workerId: string): Promise<boolean> {
    const inspection = await this.inspectContainerWorkerById(workerId);
    return inspection.exists;
  }

  public async inspectContainerWorkerById(
    workerId: string
  ): Promise<WorkerContainerInspection> {
    recordConnectionLifecycle({
      stage: 'connection.balancer.docker.container_inspect_start',
      decision: 'inspect_container_worker_by_id',
      outcome: 'started',
      container_name: workerId,
    });

    try {
      const container = this.docker.getContainer(workerId);
      const info = await container.inspect();
      const state = info.State as
        | {
            Status?: string;
            StartedAt?: string;
            FinishedAt?: string;
            Running?: boolean;
            Restarting?: boolean;
            ExitCode?: number;
            Health?: {
              Status?: string;
              FailingStreak?: number;
              Log?: Array<{
                Output?: string;
              }>;
            };
          }
        | undefined;
      const config = info.Config as
        | {
            Image?: string;
            Env?: string[];
            Labels?: Record<string, string>;
          }
        | undefined;
      const healthLog = state?.Health?.Log?.at(-1)?.Output;
      const inspection: WorkerContainerInspection = {
        exists: true,
        container_id: info.Id,
        container_name: info.Name?.replace(/^\//u, '') || workerId,
        container_image: config?.Image,
        container_image_id: (info as { Image?: string }).Image,
        container_state: state?.Status,
        container_status: (info as { Status?: string }).Status ?? state?.Status,
        container_started_at: state?.StartedAt,
        container_finished_at: state?.FinishedAt,
        container_restart_count: (info as { RestartCount?: number })
          .RestartCount,
        container_exit_code: state?.ExitCode,
        container_health_status: state?.Health?.Status,
        container_health_failing_streak: state?.Health?.FailingStreak,
        container_health_log: this.sanitizeDiagnosticText(healthLog),
        container_labels: this.getAllowedLabels(config?.Labels),
        container_env: this.getAllowedEnv(config?.Env),
        running: state?.Running === true,
      };

      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_inspect_success',
        decision: 'inspect_container_worker_by_id',
        outcome: 'success',
        ...inspection,
        raw_payload: {
          container_labels: inspection.container_labels,
          container_env: inspection.container_env,
          container_health_log: inspection.container_health_log,
        },
      });

      return inspection;
    } catch (error) {
      const inspection: WorkerContainerInspection = {
        exists: false,
        container_name: workerId,
        error: dockerErrorMessage(error),
      };

      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_inspect_missing',
        decision: 'inspect_container_worker_by_id',
        outcome: 'missing',
        container_name: workerId,
        docker_error: inspection.error,
      });

      return inspection;
    }
  }

  public async removeContainerWorkerById(workerId: string): Promise<boolean> {
    recordConnectionLifecycle({
      stage: 'connection.balancer.docker.container_remove_start',
      decision: 'remove_container_worker_by_id',
      outcome: 'started',
      container_name: workerId,
    });

    try {
      const container = this.docker.getContainer(workerId);
      await container.remove({ force: true });

      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_remove_success',
        decision: 'remove_container_worker_by_id',
        outcome: 'success',
        container_name: workerId,
      });

      return true;
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_remove_error',
        decision: 'remove_container_worker_by_id',
        outcome: 'error',
        reason: 'docker_remove_failed',
        level: 'error',
        container_name: workerId,
        error: dockerErrorMessage(error),
      });
      throw new Error('The worker removal failed');
    }
  }

  public async recordContainerDiagnostics(
    workerId: string,
    reason?: string
  ): Promise<void> {
    const inspection = await this.inspectContainerWorkerById(workerId);
    const logTail = inspection.exists
      ? await this.getContainerLogTail(workerId)
      : undefined;

    recordConnectionLifecycle({
      stage: 'connection.balancer.docker.container_diagnostics',
      decision: 'record_container_diagnostics',
      outcome: inspection.exists ? 'recorded' : 'missing',
      reason,
      container_id: inspection.container_id,
      container_name: inspection.container_name,
      container_image: inspection.container_image,
      container_image_id: inspection.container_image_id,
      container_state: inspection.container_state,
      container_status: inspection.container_status,
      container_started_at: inspection.container_started_at,
      container_finished_at: inspection.container_finished_at,
      container_restart_count: inspection.container_restart_count,
      container_exit_code: inspection.container_exit_code,
      container_health_status: inspection.container_health_status,
      container_health_failing_streak:
        inspection.container_health_failing_streak,
      container_running: inspection.running,
      raw_payload: {
        container_labels: inspection.container_labels,
        container_env: inspection.container_env,
        container_health_log: inspection.container_health_log,
        container_log_tail: logTail,
      },
    });
  }

  private async getContainerLogTail(
    workerId: string
  ): Promise<string | undefined> {
    try {
      const container = this.docker.getContainer(workerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: 80,
      });

      return this.sanitizeDiagnosticText(
        Buffer.isBuffer(logs) ? logs.toString('utf8') : String(logs)
      );
    } catch (error) {
      return this.sanitizeDiagnosticText(dockerErrorMessage(error));
    }
  }

  public async removeVolumeWorkerById(workerId: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(workerId);
      await volume.remove();

      return true;
    } catch {
      throw new Error('The worker volume removal failed');
    }
  }

  public async existsVolumeWorkerById(workerId: string): Promise<boolean> {
    try {
      const volume = this.docker.getVolume(workerId);
      await volume.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async checkVolumeAndCreate(
    workerId: string,
    isCreateVolume: boolean
  ): Promise<void> {
    const getVolume = await this.existsVolumeWorkerById(workerId);

    if (!getVolume || isCreateVolume) {
      await this.docker.createVolume({
        Name: workerId,
      });
    }
  }

  public async createContainerWorker(
    imageName: EWorkerImage,
    workerId: string,
    accountId: string,
    isCreateVolume: boolean = true,
    grpcHost?: string,
    grpcPort?: number,
    proxy?: {
      protocol?: EProxyProtocol;
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    },
    metadata?: WorkerContainerMetadata
  ): Promise<string> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);
    if (existsContainerById) {
      await this.recordContainerDiagnostics(
        workerId,
        'replace_existing_container_before_create'
      );
      await this.removeContainerWorkerById(workerId);
    }

    await this.checkVolumeAndCreate(workerId, isCreateVolume);

    const getVolume = await this.existsVolumeWorkerById(workerId);
    if (!getVolume) {
      throw new Error('Volume creation failed');
    }

    const envOverrides = [`WORKER_ID=${workerId}`, `ACCOUNT_ID=${accountId}`];
    envOverrides.push(`WORKER_IMAGE=${imageName}`);

    if (metadata?.workerTypeId) {
      envOverrides.push(`WORKER_TYPE_ID=${metadata.workerTypeId}`);
    }

    if (metadata?.workerGrpcPort !== undefined) {
      envOverrides.push(`WORKER_GRPC_PORT=${metadata.workerGrpcPort}`);
    }

    if (imageName === EWorkerImage.baileys) {
      envOverrides.push('OTEL_SERVICE_NAME=baileys');
    }

    if (imageName === EWorkerImage.wwebjs) {
      envOverrides.push('OTEL_SERVICE_NAME=wwebjs');
    }

    if (imageName === EWorkerImage.whatsmeow) {
      envOverrides.push('OTEL_SERVICE_NAME=whatsmeow');
    }

    if (grpcHost !== undefined && grpcPort !== undefined) {
      envOverrides.push(
        `BALANCER_GRPC_HOST=${grpcHost}`,
        `BALANCER_GRPC_PORT=${grpcPort}`
      );
    }

    if (proxy?.host && Number.isFinite(proxy.port)) {
      envOverrides.push(`PROXY_HOST=${proxy.host}`, `PROXY_PORT=${proxy.port}`);
      envOverrides.push(
        `PROXY_PROTOCOL=${proxy.protocol ?? EProxyProtocol.http}`
      );
      if (proxy.username) {
        envOverrides.push(`PROXY_USERNAME=${proxy.username}`);
      }
      if (proxy.password) {
        envOverrides.push(`PROXY_PASSWORD=${proxy.password}`);
      }
    }
    const labels = this.buildContainerLabels({
      imageName,
      workerId,
      accountId,
      metadata,
    });

    recordConnectionLifecycle({
      stage: 'connection.balancer.docker.container_create_start',
      decision: 'create_container_worker',
      outcome: 'started',
      container_name: workerId,
      worker_type: imageName,
      worker_type_id: metadata?.workerTypeId,
      worker_grpc_port: metadata?.workerGrpcPort,
      grpc_address:
        grpcHost !== undefined && grpcPort !== undefined
          ? `${grpcHost}:${grpcPort}`
          : undefined,
      raw_payload: {
        container_labels: labels,
        container_env: this.getAllowedEnv(envOverrides),
      },
    });

    try {
      const container = await this.docker.createContainer({
        Image: imageName,
        name: workerId,
        HostConfig: {
          Binds: [`${workerId}:/app/data`],
          NetworkMode: 'underchat',
          RestartPolicy: {
            Name: 'unless-stopped',
          },
        },
        Volumes: {
          '/app/data': {},
        },
        Env: this.buildContainerEnv(envOverrides),
        Labels: labels,
      });

      await container.start();

      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_create_success',
        decision: 'create_container_worker',
        outcome: 'created',
        container_id: container.id,
        container_name: workerId,
        worker_type: imageName,
        worker_type_id: metadata?.workerTypeId,
        worker_grpc_port: metadata?.workerGrpcPort,
      });

      return container.id;
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.docker.container_create_error',
        decision: 'create_container_worker',
        outcome: 'error',
        reason: 'docker_create_failed',
        level: 'error',
        container_name: workerId,
        worker_type: imageName,
        error: dockerErrorMessage(error),
      });
      throw error;
    }
  }

  public async existsImage(imageName: string): Promise<boolean> {
    try {
      const image = this.docker.getImage(imageName);

      await image.inspect();

      return true;
    } catch {
      return false;
    }
  }

  public async removeContainerWorker(
    workerId: string,
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      const removeContainerWorkerById =
        await this.removeContainerWorkerById(workerId);

      if (!removeContainerWorkerById) {
        throw new Error('The worker removal failed');
      }
    }

    if (isRemoveVolume) {
      const removeVolumeWorkerById =
        await this.removeVolumeWorkerById(workerId);

      if (!removeVolumeWorkerById) {
        throw new Error('The worker volume removal failed');
      }
    }

    return true;
  }

  public async cleanupContainerWorker(
    workerId: string,
    isRemoveVolume: boolean = true
  ): Promise<boolean> {
    const existsContainerById = await this.existsContainerWorkerById(workerId);

    if (existsContainerById) {
      const removeContainerWorkerById =
        await this.removeContainerWorkerById(workerId);

      if (!removeContainerWorkerById) {
        throw new Error('The worker removal failed');
      }
    }

    if (isRemoveVolume) {
      const existsVolumeById = await this.existsVolumeWorkerById(workerId);

      if (existsVolumeById) {
        const removeVolumeWorkerById =
          await this.removeVolumeWorkerById(workerId);

        if (!removeVolumeWorkerById) {
          throw new Error('The worker volume removal failed');
        }
      }
    }

    return true;
  }

  public async createWorker(input: ICreateWorker): Promise<boolean> {
    return this.workerCreatorRepository.createWorker(input);
  }

  public async listWorkerServers(): Promise<IListWorkerServer[]> {
    return this.workerServerListerRepository.listWorkerServers();
  }

  public async viewWorkerServer(
    accountId: string
  ): Promise<IViewWorkerServer | null> {
    return this.workerServerViewerRepository.viewWorkerServer(accountId);
  }

  public async totalWorkerByAccountId(accountId: string): Promise<number> {
    return this.workerTotalViewerRepository.totalWorkerByAccountId(accountId);
  }

  listWorker = async (
    accountId: string,
    perPage: number,
    currentPage: number,
    query: ListWorkerRequest
  ): Promise<[ListWorkerResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.workerListerRepository.listWorker(
        accountId,
        perPage,
        currentPage,
        query
      ),
      this.workerListerRepository.listWorkerTotal(accountId, query),
    ]);

    return [result, total];
  };

  updateWorkerById = async (
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerById(accountId, input);
  };

  updateWorkerByIdIfLifecycleMatches = async (
    accountId: string,
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    return this.workerUpdaterRepository.updateWorkerByIdIfLifecycleMatches(
      accountId,
      input,
      guard
    );
  };

  viewWorker = async (
    accountId: string,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    return this.workerViewerRepository.viewWorker(accountId, workerId);
  };

  viewWorkerNameAndContainerId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndContainerId | null> => {
    return this.workerNameAndContainerIdViewerRepository.viewWorkerNameAndContainerId(
      accountId,
      workerId
    );
  };

  existsWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerViewerExistsRepository.existsWorkerById(
      accountId,
      workerId
    );
  };

  viewWorkerBalancer = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerServer | null> => {
    return this.workerBalancerViewerRepository.viewWorkerBalancer(
      accountId,
      workerId
    );
  };

  deleteWorkerById = async (
    accountId: string,
    workerId: string
  ): Promise<boolean> => {
    return this.workerDeleterRepository.deleteWorkerById(accountId, workerId);
  };

  viewWorkerPhoneConnectionDate = async (
    workerId: string
  ): Promise<IViewWorkerPhoneConnectionDate | null> => {
    return this.workerPhoneConnectionDateViewerRepository.viewWorkerPhoneConnectionDate(
      workerId
    );
  };

  updateWorkerPhoneStatusConnectionDate = async (
    input: IUpdateWorkerPhoneStatusConnectionDate
  ): Promise<boolean> => {
    return this.workerPhoneStatusConnectionDateUpdaterRepository.updateWorkerPhoneStatusConnectionDate(
      input
    );
  };

  viewWorkerPhoneConnection = async (
    number: string
  ): Promise<IViewWorkerPhoneConnection | null> => {
    return this.workerPhoneConnectionViewerRepository.viewWorkerPhoneConnection(
      number
    );
  };

  totalWorkerPhoneConnection = async (number: string): Promise<number> => {
    return this.workerPhoneConnectionViewerRepository.totalWorkerPhoneConnection(
      number
    );
  };

  updateWorkerPhoneConnection = async (
    input: IUpdateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionUpdaterRepository.updateWorkerPhoneConnection(
      input
    );
  };

  createWorkerPhoneConnection = async (
    input: ICreateWorkerPhoneConnection
  ): Promise<boolean> => {
    return this.workerPhoneConnectionCreatorRepository.createWorkerPhoneConnection(
      input
    );
  };

  viewWorkerType = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerType | null> => {
    return this.workerTypeViewerRepository.viewWorkerType(accountId, workerId);
  };

  listWorkerBaileysActivities = async (): Promise<IListWorkerActivities[]> => {
    return this.workerBaileysActivitiesListerRepository.listWorkerBaileysActivities();
  };

  listWorkerNewStatus = async (): Promise<IListWorkerActivities[]> => {
    return this.workerNewStatusListerRepository.listWorkerNewStatus();
  };

  updateStatusWorker = async (
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> => {
    return this.workerStatusUpdaterRepository.updateStatusWorker(
      workerId,
      workerStatusId
    );
  };

  viewWorkerNameAndId = async (
    accountId: string,
    workerId: string
  ): Promise<IViewWorkerNameAndId | null> => {
    return this.workerNameAndIdViewerRepository.viewWorkerNameAndId(
      accountId,
      workerId
    );
  };

  viewWorkerConfigFieldsByWorkerId = async (
    workerId: string
  ): Promise<IWorkerConfigFields | null> => {
    const cacheKey = `worker:${workerId}:config_fields`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as IWorkerConfigFields;
      } catch {
        await this.redis.del(cacheKey);
      }
    }

    const result =
      await this.workerConfigFieldsViewerRepository.viewWorkerConfigFieldsByWorkerId(
        workerId
      );

    if (result) {
      await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 60 * 60 * 8);
    }

    return result;
  };

  listAllWorkers = async (accountId: string): Promise<TransferWorker[]> => {
    return this.workerAllListerRepository.listAllWorkers(accountId);
  };

  listWorkersForMonitor = async (): Promise<IWorkerMonitor[]> => {
    return this.workerMonitorViewerRepository.listWorkers();
  };

  viewWorkerForMonitor = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    return this.workerMonitorViewerRepository.viewWorker(workerId);
  };

  updateWorkerUpdatedAt = async (workerId: string): Promise<boolean> => {
    return this.workerUpdatedAtUpdaterRepository.updateUpdatedAt(workerId);
  };

  updateWorkerLastConnectionCheckAt = async (
    workerId: string
  ): Promise<boolean> => {
    return this.workerLastConnectionCheckUpdaterRepository.updateLastConnectionCheckAt(
      workerId
    );
  };
}
