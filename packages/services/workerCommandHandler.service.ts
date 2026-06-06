import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import {
  WorkerContainerInspection,
  WorkerService,
} from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { ChatService } from '@core/services/chat.service';
import { PublishResult } from 'centrifuge';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import {
  ContainerHealthService,
  type ContainerHealthCheckOptions,
  type ContainerHealthResult,
} from '@core/services/containerHealth.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { WorkerBaileysGrpcClientService } from '@core/services/workerBaileysGrpcClient.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';
import {
  workerCentrifugoQueue,
  channelsConfigCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { balanceEnvironment } from '@core/config/environments';
import { getErrorMessage } from '@core/common/functions/toError';
import { INotifyWorkerStatusRequestProto } from '@core/common/interfaces/INotifyWorkerStatusRequestProto';
import { currentTime } from '@core/common/functions/currentTime';
import { IResolveIncomingCallActionRequestProto } from '@core/common/interfaces/IResolveIncomingCallActionRequestProto';
import { IResolveIncomingCallActionResponseProto } from '@core/common/interfaces/IResolveIncomingCallActionResponseProto';
import { IGetTypingSimulationConfigRequestProto } from '@core/common/interfaces/IGetTypingSimulationConfigRequestProto';
import { IGetTypingSimulationConfigResponseProto } from '@core/common/interfaces/IGetTypingSimulationConfigResponseProto';
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
import { IRegisterS3BackupFallbackUploadRequestProto } from '@core/common/interfaces/IRegisterS3BackupFallbackUploadRequestProto';
import { ServerSshViewerRepository } from '@core/repositories/server/ServerSshViewer.repository';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { WorkerConfigViewerRepository } from '@core/repositories/worker/WorkerConfigViewer.repository';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { getPhoneFromJid } from '@core/common/functions/getPhoneFromJid';
import { EProxyProtocol } from '@core/common/enums/EProxyProtocol';
import { S3BackupUploadService } from '@core/services/s3BackupUpload.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { defaultTypingSimulationConfig } from '@core/common/functions/typingSimulationConfig';
import {
  buildConnectionLifecycleContext,
  recordConnectionLifecycle,
  runWithConnectionLifecycleContext,
} from '@core/plugins/telemetry/connectionLifecycleDebug';
import {
  recordConnectionQrSummary,
  summarizeConnectionQrState,
} from '@core/plugins/telemetry/connectionQrSummary';
import {
  getConnectionQrFirstQrTimeoutMs,
  getConnectionQrRecreateCooldownMs,
  recordConnectionAttemptTelemetry,
} from '@core/plugins/telemetry/connectionAttemptTelemetry';
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
import {
  ProxyConnectivityResult,
  ProxyConnectivityService,
} from '@core/services/proxyConnectivity.service';
import { WorkerWarmPoolRepository } from '@core/repositories/worker/WorkerWarmPool.repository';
import { WorkerRuntimeRepository } from '@core/repositories/worker/WorkerRuntime.repository';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import {
  IActivateWarmWorkerRequestProto,
  ICreateWarmWorkerRequestProto,
  IDeleteWarmWorkerRequestProto,
  IWarmWorkerCommandResponseProto,
} from '@core/common/interfaces/IWorkerWarmCommandProto';
import { WorkerConnectionQrCodeReadinessService } from '@core/services/workerConnectionQrCodeReadiness.service';

interface ResolvedWorkerDataForContainer {
  accountIdResolved: string;
  serverId: string;
  serverName?: string;
  serverWebDomain?: string;
  workerTypeId: EWorkerType;
  workerTypeName?: string;
  workerStatusId?: EWorkerStatus;
  containerId?: string | null;
  lifecycleOperationId?: string | null;
  runtimeGeneration?: number;
  warmPoolId?: string | null;
}

interface ResolvedWorkerProxyConfig {
  protocol: EProxyProtocol;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

interface RecreateConnectionReconciliation {
  workerStatusId: EWorkerStatus;
  connectionState?: IBaileysConnectionState;
}

interface QrConnectionAttemptRetryContext {
  payload: StatusConnectionWorkerRequest;
  accountId: string;
  workerData: ResolvedWorkerDataForContainer;
  startedAtMs: number;
}

interface QrProxyDecision {
  proxy: ResolvedWorkerProxyConfig | undefined;
  fallbackDirect: boolean;
  status: 'healthy' | 'unhealthy' | 'disabled';
  errorCode?: string;
}

interface CreateWorkerOptions {
  healthOptions?: ContainerHealthCheckOptions;
  proxyOverride?: ResolvedWorkerProxyConfig | null;
  proxyMode?: 'proxy' | 'direct' | 'direct_fallback';
}

interface RecreateSessionVolumeResolution {
  sessionVolumeName?: string;
  source:
    | 'worker_runtime'
    | 'container_label'
    | 'container_env'
    | 'legacy_worker_id'
    | 'reset';
  runtimeWasBackfilled: boolean;
}

class WorkerCreateAttemptError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly containerId?: string,
    readonly healthResult?: ContainerHealthResult
  ) {
    super(message);
    this.name = 'WorkerCreateAttemptError';
    Object.setPrototypeOf(this, WorkerCreateAttemptError.prototype);
  }
}

@injectable()
export class WorkerCommandHandlerService {
  private readonly maxRetries = 5;
  private readonly retryIntervalMs = 30 * 1000;
  private readonly connectionRequestRetryIntervalMs = 15_000;
  private readonly connectionRequestMinAttempts = 10;
  private readonly qrAttemptTtlSeconds = 180;
  private readonly qrCacheTtlSeconds = 115;
  private readonly qrMaxAgeMs = 120_000;
  private readonly qrRetryIntervalMs = 3_000;
  private readonly qrRetryMaxAttempts = 20;
  private connectionRequestTimers = new Map<string, NodeJS.Timeout>();
  private connectionRequestAttempts = new Map<string, number>();
  private connectionRequestPayloads = new Map<
    string,
    StatusConnectionWorkerRequest
  >();
  private qrConnectionRequestTimers = new Map<string, NodeJS.Timeout>();
  private qrConnectionRequestAttempts = new Map<string, number>();
  private qrConnectionRequestPayloads = new Map<
    string,
    QrConnectionAttemptRetryContext
  >();
  private qrContainerRecreateCooldowns = new Map<
    string,
    { reason: string; untilMs: number }
  >();
  private readonly defaultCallAction: IResolveIncomingCallActionResponseProto =
    {
      reject_call: false,
      show_message_on_call: false,
      show_message_text: '',
    };

  constructor(
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(KafkaBaileysQueueService)
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    @inject(ContainerHealthService)
    private readonly containerHealthService: ContainerHealthService,
    @inject(WorkerBaileysGrpcClientService)
    private readonly workerBaileysGrpcClientService: WorkerBaileysGrpcClientService,
    @inject(ServerSshViewerRepository)
    private readonly serverSshViewerRepository: ServerSshViewerRepository,
    @inject(WorkerConfigViewerRepository)
    private readonly workerConfigViewerRepository: WorkerConfigViewerRepository,
    @inject(PasswordEncryptorService)
    private readonly passwordEncryptorService: PasswordEncryptorService,
    @inject(S3BackupUploadService)
    private readonly s3BackupUploadService: S3BackupUploadService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(WorkerLifecycleLockService)
    private readonly workerLifecycleLockService: WorkerLifecycleLockService,
    @inject(ProxyConnectivityService)
    private readonly proxyConnectivityService: ProxyConnectivityService,
    @inject(WorkerConnectionQrCodeReadinessService)
    private readonly workerConnectionQrCodeReadinessService: WorkerConnectionQrCodeReadinessService,
    @inject('Redis')
    private readonly redis: Redis,
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never
  ) {}

  private isTopicOrPartitionMissing(err: unknown): boolean {
    const msg = getErrorMessage(err).toLowerCase();
    return (
      msg.includes('unknown partition') ||
      msg.includes('unknown topic') ||
      msg.includes('topic or partition')
    );
  }

  private normalizeProxyProtocol(
    protocol: string | null | undefined
  ): EProxyProtocol {
    if (!protocol) {
      return EProxyProtocol.http;
    }

    if (Object.values(EProxyProtocol).includes(protocol as EProxyProtocol)) {
      return protocol as EProxyProtocol;
    }

    return EProxyProtocol.http;
  }

  async handle(data: IWorkerPayload): Promise<void> {
    if (data.action === EWorkerAction.create) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'create_worker',
        () => this.createWorker(data)
      );
      return;
    }

    if (data.action === EWorkerAction.delete) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'delete_worker',
        async () => {
          try {
            await this.kafkaBaileysQueueService.delete(data.worker_id);
          } catch (err) {
            if (!this.isTopicOrPartitionMissing(err)) {
              throw err;
            }
          }
          await this.deleteWorker(data);
        }
      );
      return;
    }

    if (data.action === EWorkerAction.cleanup) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'cleanup_worker',
        () => this.cleanupWorker(data)
      );
      return;
    }

    if (data.action === EWorkerAction.recreate) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'recreate_worker',
        async () => {
          try {
            await this.kafkaBaileysQueueService.delete(data.worker_id);
          } catch {}
          await this.recreateWorker(data);
        }
      );
    }
  }

  async createWarmWorker(
    data: ICreateWarmWorkerRequestProto
  ): Promise<IWarmWorkerCommandResponseProto> {
    if (!data.warm_pool_id || !data.server_id || !data.worker_type_id) {
      throw new Error(
        'Missing required fields: warm_pool_id, server_id, worker_type_id'
      );
    }

    const workerType = data.worker_type_id as EWorkerType;
    if (!Object.values(EWorkerType).includes(workerType)) {
      throw new Error('Invalid worker_type_id');
    }

    const imageName = getImageWorker(workerType);
    const sessionVolumeName = `warm-${data.warm_pool_id}`;
    const startedAt = Date.now();

    await this.workerWarmPoolRepository.create({
      warm_pool_id: data.warm_pool_id,
      server_id: data.server_id,
      worker_type_id: workerType,
      session_volume_name: sessionVolumeName,
      state: EWorkerWarmPoolState.warming,
    });

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.create_start',
      decision: 'create_warm_worker',
      outcome: 'started',
      warm_pool_id: data.warm_pool_id,
      server_id: data.server_id,
      worker_type: workerType,
      worker_type_id: workerType,
      session_volume_name: sessionVolumeName,
    });

    try {
      const proxy = await this.resolveServerProxyConfig(data.server_id);
      const runtime = await this.workerService.createWarmContainerWorker({
        imageName,
        warmPoolId: data.warm_pool_id,
        serverId: data.server_id,
        workerTypeId: workerType,
        grpcHost: balanceEnvironment.grpcHost,
        grpcPort: balanceEnvironment.grpcPort,
        workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
        proxy,
      });

      await this.containerHealthService.checkServiceHealth(
        runtime.container_id,
        this.buildNewContainerHealthOptions()
      );

      if (this.isWorkerGrpcReadinessRequired(workerType)) {
        await this.workerBaileysGrpcClientService.waitForReady(
          runtime.container_name,
          workerType,
          30_000
        );
        await this.workerBaileysGrpcClientService.runtimeHealth(
          runtime.container_name,
          {
            warm_pool_id: data.warm_pool_id,
          },
          workerType
        );
      }

      await this.workerWarmPoolRepository.markRuntime({
        warm_pool_id: data.warm_pool_id,
        container_id: runtime.container_id,
        container_name: runtime.container_name,
        session_volume_name: runtime.session_volume_name,
        state: EWorkerWarmPoolState.ready,
      });

      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.create_success',
        decision: 'create_warm_worker',
        outcome: 'success',
        warm_pool_id: data.warm_pool_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        container_id: runtime.container_id,
        container_name: runtime.container_name,
        session_volume_name: runtime.session_volume_name,
        duration_ms: Date.now() - startedAt,
      });

      return {
        warm_pool_id: data.warm_pool_id,
        container_id: runtime.container_id,
        container_name: runtime.container_name,
        session_volume_name: runtime.session_volume_name,
      };
    } catch (error) {
      await this.workerWarmPoolRepository.markRuntime({
        warm_pool_id: data.warm_pool_id,
        state: EWorkerWarmPoolState.error,
        last_error: getErrorMessage(error),
      });
      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.create_error',
        decision: 'create_warm_worker',
        outcome: 'error',
        reason: 'warm_create_failed',
        level: 'error',
        warm_pool_id: data.warm_pool_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        session_volume_name: sessionVolumeName,
        duration_ms: Date.now() - startedAt,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  async deleteWarmWorker(data: IDeleteWarmWorkerRequestProto): Promise<void> {
    const containerName =
      data.container_name ||
      (data.warm_pool_id ? `warm-${data.warm_pool_id}` : '');
    const volumeName =
      data.session_volume_name ||
      (data.warm_pool_id ? `warm-${data.warm_pool_id}` : undefined);

    if (data.warm_pool_id) {
      await this.workerWarmPoolRepository.markDeleting(data.warm_pool_id);
    }

    if (containerName) {
      await this.workerService.removeContainerByNameAndVolume(
        containerName,
        volumeName,
        data.remove_volume === true
      );
    } else if (data.remove_volume === true && volumeName) {
      const existsVolume =
        await this.workerService.existsVolumeByName(volumeName);
      if (existsVolume) {
        await this.workerService.removeVolumeByName(volumeName);
      }
    } else {
      throw new Error('Missing warm container_name, warm_pool_id or volume');
    }

    if (data.warm_pool_id) {
      await this.workerWarmPoolRepository.deleteById(data.warm_pool_id);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.delete_success',
      decision: 'delete_warm_worker',
      outcome: 'success',
      warm_pool_id: data.warm_pool_id,
      server_id: data.server_id,
      worker_type_id: data.worker_type_id,
      container_name: containerName,
      session_volume_name: volumeName,
      remove_volume: data.remove_volume === true,
      reason: data.reason,
    });
  }

  async activateWarmWorker(
    data: IActivateWarmWorkerRequestProto
  ): Promise<IWarmWorkerCommandResponseProto> {
    if (
      !data.warm_pool_id ||
      !data.worker_id ||
      !data.account_id ||
      !data.server_id ||
      !data.worker_type_id
    ) {
      throw new Error(
        'Missing required fields: warm_pool_id, worker_id, account_id, server_id, worker_type_id'
      );
    }

    const warm = await this.workerWarmPoolRepository.viewById(
      data.warm_pool_id
    );
    if (!warm) {
      throw new Error('Warm pool entry not found');
    }

    const workerType = data.worker_type_id as EWorkerType;
    const sourceContainerName =
      warm.container_name || `warm-${data.warm_pool_id}`;
    const sessionVolumeName =
      warm.session_volume_name || `warm-${data.warm_pool_id}`;
    const startedAt = Date.now();
    const sourceInspection =
      await this.workerService.inspectContainerWorkerById(sourceContainerName);
    const rejectionReason = this.validateWarmActivation(
      data,
      warm,
      sourceInspection,
      workerType
    );
    if (rejectionReason) {
      await this.rejectWarmActivation(
        data,
        warm,
        sourceInspection,
        rejectionReason,
        startedAt
      );
      throw new Error(`Warm pool activation rejected: ${rejectionReason}`);
    }
    if (
      data.lifecycle_operation_id &&
      !(await this.isLifecycleOperationCurrent(
        {
          action: EWorkerAction.create,
          worker_id: data.worker_id,
          account_id: data.account_id,
          server_id: data.server_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
        },
        'activate_warm_worker'
      ))
    ) {
      await this.rejectWarmActivation(
        data,
        warm,
        sourceInspection,
        'stale_lifecycle_operation',
        startedAt
      );
      throw new Error(
        'Warm pool activation rejected: stale_lifecycle_operation'
      );
    }

    await this.invalidateQrAttemptState(data.worker_id, {
      accountId: data.account_id,
      workerType,
      reason: 'warm_activation_runtime_replacement',
      recreateReason:
        data.remove_volume === true
          ? 'activate_warm_with_volume_reset'
          : 'activate_warm_container_replaced',
    });

    await this.kafkaBaileysQueueService.ensure(data.worker_id);

    await this.removeExistingRuntimeBeforeWarmActivation(
      data,
      sourceContainerName,
      workerType
    );

    await this.workerService.renameContainer(
      sourceContainerName,
      data.worker_id
    );

    const activation =
      await this.workerBaileysGrpcClientService.activateRuntime(
        data.worker_id,
        {
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          warm_pool_id: data.warm_pool_id,
          session_volume_name: sessionVolumeName,
          balancer_grpc_host: balanceEnvironment.grpcHost,
          balancer_grpc_port: balanceEnvironment.grpcPort,
        },
        workerType
      );

    if (!activation.activated) {
      throw new Error(activation.error || 'Warm runtime activation failed');
    }

    const activatedInspection =
      await this.workerService.inspectContainerWorkerById(data.worker_id);
    const runtime = await this.workerRuntimeRepository?.upsert({
      worker_id: data.worker_id,
      container_id: activatedInspection.container_id ?? warm.container_id,
      container_name: data.worker_id,
      session_volume_name: sessionVolumeName,
      warm_pool_id: data.warm_pool_id,
      activated_at: currentTime(),
    });

    try {
      await this.waitForConnectionQrCodeConsumerReady(
        data.worker_id,
        data.account_id,
        workerType,
        'activate_warm_worker'
      );
    } catch (error) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        EWorkerAction.create,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw error;
    }

    await this.workerWarmPoolRepository.markAssigned(
      data.warm_pool_id,
      data.worker_id
    );
    await this.workerService.updateWorkerById(data.account_id, {
      worker_id: data.worker_id,
      container_id: activatedInspection.container_id ?? warm.container_id,
      worker_status_id: EWorkerStatus.disponible,
    });

    await this.publishWarmActivationDisponible(
      data,
      workerType,
      activatedInspection.container_id ?? warm.container_id ?? undefined,
      runtime?.runtime_generation
    );

    if (runtime?.runtime_generation !== undefined) {
      recordConnectionAttemptTelemetry({
        event: 'worker_runtime_generation_updated',
        stage: 'connection.balancer.runtime.generation_updated',
        metric_event: 'runtime_generation',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type: workerType,
        warm_pool_id: data.warm_pool_id,
        container_id:
          activatedInspection.container_id ?? warm.container_id ?? undefined,
        runtime_generation: runtime.runtime_generation,
        outcome: 'updated',
      });
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.activate_success',
      decision: 'activate_warm_worker',
      outcome: 'success',
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type: workerType,
      worker_type_id: workerType,
      previous_worker_type_id: data.previous_worker_type_id,
      previous_worker_status_id: data.previous_worker_status_id,
      container_id: activatedInspection.container_id ?? warm.container_id,
      container_name: data.worker_id,
      session_volume_name: sessionVolumeName,
      runtime_generation: runtime?.runtime_generation,
      duration_ms: Date.now() - startedAt,
    });

    return {
      warm_pool_id: data.warm_pool_id,
      worker_id: data.worker_id,
      container_id: activatedInspection.container_id ?? warm.container_id ?? '',
      container_name: data.worker_id,
      session_volume_name: sessionVolumeName,
      claimed: true,
    };
  }

  private async removeExistingRuntimeBeforeWarmActivation(
    data: IActivateWarmWorkerRequestProto,
    sourceContainerName: string,
    workerType: EWorkerType
  ): Promise<void> {
    if (!data.worker_id) {
      return;
    }

    const targetInspection =
      await this.workerService.inspectContainerWorkerById(data.worker_id);
    if (
      !targetInspection.exists ||
      targetInspection.container_name === sourceContainerName
    ) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.old_runtime_remove_skipped',
        decision: 'remove_existing_runtime_before_warm_activation',
        outcome: 'skipped',
        reason: targetInspection.exists
          ? 'target_is_warm_source'
          : 'target_container_missing',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        previous_worker_type_id: data.previous_worker_type_id,
        warm_pool_id: data.warm_pool_id,
        ...this.lifecycleFieldsFromInspection(targetInspection),
      });
      return;
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.old_runtime_remove_start',
      decision: 'remove_existing_runtime_before_warm_activation',
      outcome: 'started',
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type: workerType,
      worker_type_id: workerType,
      previous_worker_type_id: data.previous_worker_type_id,
      remove_volume: data.remove_volume === true,
      warm_pool_id: data.warm_pool_id,
      ...this.lifecycleFieldsFromInspection(targetInspection),
    });

    await this.workerService.recordContainerDiagnostics(
      data.worker_id,
      'remove_existing_container_before_warm_activation'
    );

    const removed = await this.retryOperation(
      async () =>
        this.removeRuntimeContainer(
          data.worker_id ?? '',
          data.remove_volume === true
        ),
      (result) => !result
    );

    if (!removed) {
      throw new Error('Worker removal failed before warm activation');
    }

    await this.waitForContainerNameReleased(data.worker_id, 10, 300);

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.old_runtime_remove_success',
      decision: 'remove_existing_runtime_before_warm_activation',
      outcome: 'success',
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type: workerType,
      worker_type_id: workerType,
      previous_worker_type_id: data.previous_worker_type_id,
      remove_volume: data.remove_volume === true,
      warm_pool_id: data.warm_pool_id,
      ...this.lifecycleFieldsFromInspection(targetInspection),
    });
  }

  private async waitForContainerNameReleased(
    containerName: string,
    maxAttempts: number,
    delayMs: number
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const inspection =
        await this.workerService.inspectContainerWorkerById(containerName);
      if (!inspection.exists) {
        return;
      }

      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.old_runtime_remove_wait',
        decision: 'wait_container_name_released',
        outcome: 'waiting',
        reason: 'target_container_name_still_exists',
        level: 'warn',
        container_name: containerName,
        attempt,
        max_attempts: maxAttempts,
        delay_ms: delayMs,
        ...this.lifecycleFieldsFromInspection(inspection),
      });

      if (attempt < maxAttempts) {
        await this.sleep(delayMs);
      }
    }
  }

  private async publishWarmActivationDisponible(
    data: IActivateWarmWorkerRequestProto,
    workerType: EWorkerType,
    containerId?: string,
    runtimeGeneration?: number
  ): Promise<void> {
    if (!data.worker_id || !data.account_id) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.disponible_publish_skipped',
        decision: 'publish_warm_activation_disponible',
        outcome: 'skipped',
        reason: 'missing_worker_or_account',
        level: 'warn',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        warm_pool_id: data.warm_pool_id,
      });
      return;
    }

    const state: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
      connection_lifecycle_id: data.lifecycle_operation_id,
      warm_pool_id: data.warm_pool_id,
      container_id: containerId,
      runtime_generation: runtimeGeneration,
      reason: 'warm_activation_disponible',
    };

    try {
      await Promise.all([
        this.centrifugoService.publishSub(
          workerCentrifugoQueue(data.account_id),
          state
        ),
        this.centrifugoService.publish(channelsConfigCentrifugo(), {
          action: EWorkerAction.create,
          worker_id: data.worker_id,
          account_id: data.account_id,
          server_id: data.server_id ?? '',
          worker_type_id: workerType,
          worker_status_id: EWorkerStatus.disponible,
          lifecycle_operation_id: data.lifecycle_operation_id,
        }),
      ]);

      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.disponible_published',
        decision: 'publish_warm_activation_disponible',
        outcome: 'published',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        worker_status_id: EWorkerStatus.disponible,
        warm_pool_id: data.warm_pool_id,
        container_id: containerId,
        runtime_generation: runtimeGeneration,
        centrifugo_channel: workerCentrifugoQueue(data.account_id),
      });
    } catch (error) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.warm_pool.disponible_publish_error',
        decision: 'publish_warm_activation_disponible',
        outcome: 'error',
        reason: 'centrifugo_publish_failed',
        level: 'warn',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type: workerType,
        worker_type_id: workerType,
        worker_status_id: EWorkerStatus.disponible,
        warm_pool_id: data.warm_pool_id,
        container_id: containerId,
        runtime_generation: runtimeGeneration,
        error: getErrorMessage(error),
      });
    }
  }

  private validateWarmActivation(
    data: IActivateWarmWorkerRequestProto,
    warm: IWorkerWarmPool,
    sourceInspection: WorkerContainerInspection,
    workerType: EWorkerType
  ): string | undefined {
    if (warm.server_id !== data.server_id) {
      return 'server_mismatch';
    }
    if (warm.worker_type_id !== data.worker_type_id) {
      return 'worker_type_mismatch';
    }
    if (warm.state !== EWorkerWarmPoolState.reserved) {
      return 'warm_pool_state_not_reserved';
    }
    if (warm.reserved_by_worker_id !== data.worker_id) {
      return 'reserved_worker_mismatch';
    }
    if (warm.reservation_expires_at) {
      const expiresAtMs = Date.parse(warm.reservation_expires_at);
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
        return 'reservation_expired';
      }
    }
    if (!sourceInspection.exists) {
      return 'source_container_missing';
    }
    if (sourceInspection.running !== true) {
      return 'source_container_not_running';
    }

    const labels = sourceInspection.container_labels ?? {};
    const env = sourceInspection.container_env ?? {};
    const expectedImage = getImageWorker(workerType);
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(workerType);
    const expectedGrpcPortValue =
      expectedGrpcPort === undefined ? undefined : String(expectedGrpcPort);

    if (
      sourceInspection.container_image &&
      sourceInspection.container_image !== expectedImage
    ) {
      return 'container_image_mismatch';
    }
    if (
      labels['underchat.worker_image'] &&
      labels['underchat.worker_image'] !== expectedImage
    ) {
      return 'container_label_image_mismatch';
    }
    if (env.WORKER_IMAGE && env.WORKER_IMAGE !== expectedImage) {
      return 'container_env_image_mismatch';
    }
    if (
      labels['underchat.warm_pool_id'] &&
      labels['underchat.warm_pool_id'] !== data.warm_pool_id
    ) {
      return 'container_label_warm_pool_mismatch';
    }
    if (
      labels['underchat.server_id'] &&
      labels['underchat.server_id'] !== data.server_id
    ) {
      return 'container_label_server_mismatch';
    }
    if (
      labels['underchat.worker_type_id'] &&
      labels['underchat.worker_type_id'] !== data.worker_type_id
    ) {
      return 'container_label_worker_type_mismatch';
    }
    if (env.WORKER_TYPE_ID && env.WORKER_TYPE_ID !== data.worker_type_id) {
      return 'container_env_worker_type_mismatch';
    }
    if (env.WARM_POOL_ID && env.WARM_POOL_ID !== data.warm_pool_id) {
      return 'container_env_warm_pool_mismatch';
    }
    if (env.WARM_STANDBY && env.WARM_STANDBY !== 'true') {
      return 'container_env_not_warm_standby';
    }
    if (
      expectedGrpcPortValue &&
      labels['underchat.worker_grpc_port'] &&
      labels['underchat.worker_grpc_port'] !== expectedGrpcPortValue
    ) {
      return 'container_label_grpc_port_mismatch';
    }
    if (
      expectedGrpcPortValue &&
      env.WORKER_GRPC_PORT &&
      env.WORKER_GRPC_PORT !== expectedGrpcPortValue
    ) {
      return 'container_env_grpc_port_mismatch';
    }

    return undefined;
  }

  private async rejectWarmActivation(
    data: IActivateWarmWorkerRequestProto,
    warm: IWorkerWarmPool,
    sourceInspection: WorkerContainerInspection,
    reason: string,
    startedAt: number
  ): Promise<void> {
    await this.workerWarmPoolRepository.markRuntime({
      warm_pool_id: warm.warm_pool_id,
      state: EWorkerWarmPoolState.error,
      last_error: reason,
    });

    recordConnectionLifecycle({
      stage: 'connection.balancer.warm_pool.activate_rejected',
      decision: 'activate_warm_worker',
      outcome: 'rejected',
      reason,
      level: 'warn',
      warm_pool_id: warm.warm_pool_id,
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type: data.worker_type_id,
      worker_type_id: data.worker_type_id,
      reserved_by_worker_id: warm.reserved_by_worker_id,
      warm_state: warm.state,
      reservation_expires_at: warm.reservation_expires_at,
      duration_ms: Date.now() - startedAt,
      ...this.lifecycleFieldsFromInspection(sourceInspection),
    });
    recordConnectionAttemptTelemetry({
      event: 'warm_activation_rejected',
      stage: 'connection.balancer.warm_pool.activate_rejected',
      metric_event: 'warm_activation_rejection',
      level: 'warn',
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      worker_type: data.worker_type_id,
      warm_pool_id: warm.warm_pool_id,
      container_id: sourceInspection.container_id,
      container_name: sourceInspection.container_name,
      outcome: 'rejected',
      reason,
      duration_ms: Date.now() - startedAt,
    });
  }

  private async runWithWorkerLifecycleLock<T>(
    workerId: string,
    operation: string,
    callback: () => Promise<T>
  ): Promise<T> {
    return this.workerLifecycleLockService.withLock(
      workerId,
      operation,
      callback
    );
  }

  async handleChangeConnectionStatus(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: input.worker_id,
      channel_id: input.worker_id,
      source_provider: 'balancer',
      connection_type: input.type,
      connection_action: 'change_status',
    });

    await runWithConnectionLifecycleContext(contextData, async () => {
      await this.handleChangeConnectionStatusWithLifecycle(input, accountId);
    });
  }

  private async handleChangeConnectionStatusWithLifecycle(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: input.status,
      type: input.type,
      phone_connection: input.phone_connection,
      remove_session: input.remove_session,
    };
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.status_change_received',
      decision: 'change_connection_status',
      outcome: 'received',
      status: payload.status,
      connection_type: payload.type,
      remove_session: payload.remove_session === true,
    });

    if (
      payload.status === EWorkerStatus.online &&
      payload.type === EBaileysConnectionType.qrcode
    ) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.status_change_rejected',
        decision: 'connection_status_validation',
        outcome: 'error',
        reason: 'qrcode_requires_request_connection_qrcode',
        level: 'warn',
        status: payload.status,
        connection_type: payload.type,
      });
      throw new Error('Use RequestConnectionQrCode for QR Code connections.');
    }

    this.publishConnectionIntent(payload, accountId);

    if (payload.status === EWorkerStatus.online) {
      this.startOnlineConnectionWorkflow(payload, accountId);
      return;
    }

    this.stopConnectionRequestRetry(payload.worker_id);
    await this.runWithWorkerLifecycleLock(
      payload.worker_id,
      'change_status_worker_request',
      async () => {
        try {
          const workerType = await this.resolveWorkerTypeForConnection(
            input.worker_id,
            accountId
          );
          recordConnectionLifecycle({
            stage: 'connection.balancer.command_handler.worker_request_start',
            decision: 'request_worker_connection',
            outcome: 'started',
            worker_type: workerType,
            status: payload.status,
            connection_type: payload.type,
          });
          await this.workerBaileysGrpcClientService.requestConnection(
            input.worker_id,
            payload,
            workerType
          );
          recordConnectionLifecycle({
            stage: 'connection.balancer.command_handler.worker_request_success',
            decision: 'request_worker_connection',
            outcome: 'success',
            worker_type: workerType,
            status: payload.status,
            connection_type: payload.type,
          });
        } catch (err) {
          if (this.isTopicOrPartitionMissing(err)) {
            recordConnectionLifecycle({
              stage: 'connection.balancer.command_handler.worker_request_skip',
              decision: 'request_worker_connection',
              outcome: 'skipped',
              reason: 'topic_or_partition_missing',
              level: 'warn',
              status: payload.status,
              connection_type: payload.type,
            });
            return;
          }

          recordConnectionLifecycle({
            stage: 'connection.balancer.command_handler.worker_request_error',
            decision: 'request_worker_connection',
            outcome: 'error',
            reason: 'worker_request_failed',
            level: 'error',
            status: payload.status,
            connection_type: payload.type,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      }
    );
  }

  async handleRequestConnectionQrCode(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: input.worker_id,
      channel_id: input.worker_id,
      source_provider: 'balancer',
      connection_type: EBaileysConnectionType.qrcode,
      connection_action: 'request_qrcode',
    });

    return runWithConnectionLifecycleContext(contextData, async () => {
      return this.handleRequestConnectionQrCodeWithLifecycle(input, accountId);
    });
  }

  private async handleRequestConnectionQrCodeWithLifecycle(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_received',
      decision: 'request_connection_qrcode',
      outcome: 'received',
      status: input.status,
      connection_type: input.type,
    });
    if (input.type === EBaileysConnectionType.phone) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.qrcode_rejected',
        decision: 'connection_type_validation',
        outcome: 'error',
        reason: 'phone_connection_disabled',
        level: 'warn',
      });
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    this.stopConnectionRequestRetry(input.worker_id);
    return this.runWithWorkerLifecycleLock(
      input.worker_id,
      'request_qrcode',
      async () => {
        const { payload, cachedState, shouldReturnCached } =
          await this.resolveQrRequestPayload(input, accountId);

        if (shouldReturnCached && cachedState) {
          if (cachedState.qrcode || cachedState.pairing_code) {
            return this.buildQrReadyStateFromState(
              cachedState,
              payload,
              accountId
            );
          }

          return this.buildQrPendingStateFromState(
            cachedState,
            payload,
            accountId
          );
        }

        return this.runConnectionQrCodeWorkflow(payload, accountId);
      }
    );
  }

  private publishConnectionIntent(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): void {
    if (!accountId) {
      return;
    }

    if (payload.status === EWorkerStatus.online) {
      void this.centrifugoPublish({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: payload.worker_id,
        account_id: accountId,
      }).catch((err) => {
        console.error('Failed to publish connection start intent:', err);
      });
      return;
    }

    if (payload.status === EWorkerStatus.disponible) {
      void this.centrifugoPublish({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_id: payload.worker_id,
        account_id: accountId,
        disconnected_user: true,
      }).catch((err) => {
        console.error('Failed to publish connection logout intent:', err);
      });
    }
  }

  async notifyWorkerStatus(
    input: INotifyWorkerStatusRequestProto
  ): Promise<void> {
    const workerId = input.worker_id;
    const accountId = input.account_id;
    const workerStatusId = input.worker_status_id as EWorkerStatus | undefined;
    const contextData = buildConnectionLifecycleContext({
      account_id: accountId,
      worker_id: workerId,
      channel_id: workerId,
      source_provider: 'balancer',
      connection_action: 'notify_worker_status',
    });

    await runWithConnectionLifecycleContext(contextData, async () => {
      await this.notifyWorkerStatusWithLifecycle(input, workerStatusId);
    });
  }

  private async notifyWorkerStatusWithLifecycle(
    input: INotifyWorkerStatusRequestProto,
    workerStatusId: EWorkerStatus | undefined
  ): Promise<void> {
    const workerId = input.worker_id;
    const accountId = input.account_id;
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.notify_status_received',
      decision: 'notify_worker_status',
      outcome: 'received',
      worker_status_id: workerStatusId,
      status: input.status,
      code: input.code,
      connection_attempt_id: input.connection_attempt_id,
      connection_lifecycle_id: input.connection_lifecycle_id,
      has_phone: Boolean(input.phone),
      has_qr: Boolean(input.qrcode),
      has_pairing_code: Boolean(input.pairing_code),
      qr_pending: input.qr_pending === true,
      disconnected_user: input.disconnected_user === true,
    });

    if (!workerId || !accountId || !workerStatusId) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.notify_status_rejected',
        decision: 'required_fields_validation',
        outcome: 'error',
        reason: 'missing_required_fields',
        level: 'warn',
        worker_status_id: workerStatusId,
        connection_attempt_id: input.connection_attempt_id,
        connection_lifecycle_id: input.connection_lifecycle_id,
      });
      throw new Error(
        'Missing required fields: worker_id, account_id, worker_status_id'
      );
    }

    const payload = this.buildNotifyWorkerStatusPayload(
      input,
      workerId,
      accountId,
      workerStatusId
    );
    const shouldPublishAsQrAttempt = this.isNotifyQrAttemptState(payload);
    const isDisponibleWithDisconnectedUser =
      workerStatusId === EWorkerStatus.disponible &&
      input.disconnected_user === true;

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.notify_status_payload_built',
      decision: 'notify_worker_status',
      outcome: 'success',
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      connection_attempt_id: payload.connection_attempt_id,
      connection_lifecycle_id: payload.connection_lifecycle_id,
      has_phone: Boolean(payload.phone),
      has_qr: Boolean(payload.qrcode),
      has_pairing_code: Boolean(payload.pairing_code),
      qr_pending: payload.qr_pending === true,
      publish_source: shouldPublishAsQrAttempt
        ? 'notify_qrcode_attempt'
        : 'notify_worker_status',
    });

    if (isDisponibleWithDisconnectedUser) {
      const updateInput: IUpdateWorker = {
        worker_id: workerId,
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        container_id: null,
        connection_date: null,
      };

      await this.workerService.updateWorkerById(accountId, updateInput);
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.notify_status_success',
        decision: 'notify_worker_status',
        outcome: 'success',
        worker_status_id: workerStatusId,
        status: payload.status,
        code: payload.code,
        connection_attempt_id: payload.connection_attempt_id,
        connection_lifecycle_id: payload.connection_lifecycle_id,
        disconnected_user: true,
      });

      return;
    }

    if (
      await this.shouldDeferDisponibleWorkerNotification(
        accountId,
        workerId,
        workerStatusId
      )
    ) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.notify_status_deferred',
        decision: 'notify_worker_status',
        outcome: 'deferred',
        reason: 'worker_lifecycle_readiness_pending',
        worker_status_id: workerStatusId,
        status: payload.status,
        code: payload.code,
        connection_attempt_id: payload.connection_attempt_id,
        connection_lifecycle_id: payload.connection_lifecycle_id,
        has_qr: Boolean(payload.qrcode),
      });
      return;
    }

    const view =
      await this.workerService.viewWorkerPhoneConnectionDate(workerId);

    const inputPhone = payload.phone?.trim() || null;
    const phoneNumber = inputPhone ?? view?.number ?? null;

    let connectionDate = view?.connection_date;
    if (workerStatusId === EWorkerStatus.online && phoneNumber) {
      connectionDate = currentTime();
    }

    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: workerId,
      status: workerStatusId,
      number: phoneNumber,
      connection_date: connectionDate,
    });

    let qrAttemptPublished: boolean | undefined;
    if (shouldPublishAsQrAttempt) {
      qrAttemptPublished = await this.cacheAndPublishQrAttemptState(payload, {
        event: payload.qrcode
          ? 'balancer_qrcode_notify_status_generated'
          : 'balancer_qrcode_notify_status_pending',
        reason: payload.reason ?? 'notify_worker_status',
        timeToFirstQrMs: payload.time_to_first_qr_ms,
        publishSource: 'notify_worker_status',
        level: payload.qrcode ? 'info' : 'warn',
      });

      if (qrAttemptPublished) {
        await this.centrifugoService.publish(
          channelsConfigCentrifugo(),
          payload
        );
      }
    } else {
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.notify_status_success',
      decision: 'notify_worker_status',
      outcome: 'success',
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      connection_attempt_id: payload.connection_attempt_id,
      connection_lifecycle_id: payload.connection_lifecycle_id,
      has_phone: Boolean(phoneNumber),
      has_qr: Boolean(payload.qrcode),
      has_pairing_code: Boolean(payload.pairing_code),
      qr_pending: payload.qr_pending === true,
      qr_attempt_published: qrAttemptPublished,
    });
  }

  private buildNotifyWorkerStatusPayload(
    input: INotifyWorkerStatusRequestProto,
    workerId: string,
    accountId: string,
    workerStatusId: EWorkerStatus
  ): IBaileysConnectionState {
    const payload: IBaileysConnectionState = {
      code: this.normalizeNotifyCode(input.code),
      status: this.normalizeNotifyStatus(input.status),
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: workerStatusId,
      phone: input.phone || undefined,
      disconnected_user: input.disconnected_user ?? undefined,
      connection_attempt_id: input.connection_attempt_id || undefined,
      connection_lifecycle_id: input.connection_lifecycle_id || undefined,
      qrcode: input.qrcode || undefined,
      pairing_code: input.pairing_code || undefined,
      qr_pending: input.qr_pending === true ? true : undefined,
      qr_generated_at: input.qr_generated_at || undefined,
      reason: input.reason || undefined,
      error: input.error || undefined,
      container_id: input.container_id || undefined,
      warm_pool_id: input.warm_pool_id || undefined,
    };

    if (input.proxy_status) {
      payload.proxy_status =
        input.proxy_status as IBaileysConnectionState['proxy_status'];
    }
    if (input.proxy_error_code) {
      payload.proxy_error_code = input.proxy_error_code;
    }
    if (input.proxy_fallback) {
      payload.proxy_fallback =
        input.proxy_fallback as IBaileysConnectionState['proxy_fallback'];
    }
    if (input.proxy_bypassed === true) {
      payload.proxy_bypassed = true;
    }
    if (input.is_new_login === true) {
      payload.is_new_login = true;
    }

    const attempt = this.normalizeNotifyOptionalNumber(input.attempt);
    const maxAttempts = this.normalizeNotifyOptionalNumber(input.max_attempts);
    const time = this.normalizeNotifyOptionalNumber(input.time);
    const secondsUntilNextAttempt = this.normalizeNotifyOptionalNumber(
      input.seconds_until_next_attempt
    );
    const timeToFirstQrMs = this.normalizeNotifyOptionalNumber(
      input.time_to_first_qr_ms
    );
    const runtimeGeneration = this.normalizeNotifyOptionalNumber(
      input.runtime_generation
    );

    if (attempt !== undefined) payload.attempt = attempt;
    if (maxAttempts !== undefined) payload.max_attempts = maxAttempts;
    if (time !== undefined) payload.time = time;
    if (secondsUntilNextAttempt !== undefined) {
      payload.seconds_until_next_attempt = secondsUntilNextAttempt;
    }
    if (timeToFirstQrMs !== undefined) {
      payload.time_to_first_qr_ms = timeToFirstQrMs;
    }
    if (runtimeGeneration !== undefined) {
      payload.runtime_generation = runtimeGeneration;
    }
    if (payload.qrcode && payload.qr_pending !== true) {
      payload.qr_pending = false;
    }

    return payload;
  }

  private normalizeNotifyCode(code: unknown): ECodeMessage {
    const value = this.normalizeNotifyOptionalNumber(code);
    const validCodes = Object.values(ECodeMessage).filter(
      (candidate): candidate is ECodeMessage => typeof candidate === 'number'
    );

    return value !== undefined && validCodes.includes(value as ECodeMessage)
      ? (value as ECodeMessage)
      : ECodeMessage.info;
  }

  private normalizeNotifyStatus(
    statusValue: unknown
  ): EBaileysConnectionStatus {
    if (
      typeof statusValue === 'string' &&
      Object.values(EBaileysConnectionStatus).includes(
        statusValue as EBaileysConnectionStatus
      )
    ) {
      return statusValue as EBaileysConnectionStatus;
    }

    return EBaileysConnectionStatus.info;
  }

  private normalizeNotifyOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
    }

    return undefined;
  }

  private isNotifyQrAttemptState(payload: IBaileysConnectionState): boolean {
    return (
      Boolean(payload.qrcode) ||
      Boolean(payload.pairing_code) ||
      payload.qr_pending === true ||
      payload.code === ECodeMessage.awaitingReadQrCode ||
      payload.code === ECodeMessage.awaitingPairingCode ||
      payload.code === ECodeMessage.pairingInProgress
    );
  }

  private async shouldDeferDisponibleWorkerNotification(
    accountId: string,
    workerId: string,
    workerStatusId: EWorkerStatus
  ): Promise<boolean> {
    if (workerStatusId !== EWorkerStatus.disponible) {
      return false;
    }

    let currentStatus: EWorkerStatus | undefined;
    try {
      const worker = await this.workerService.viewWorker(accountId, workerId);
      currentStatus = worker?.status?.id as EWorkerStatus | undefined;
    } catch (err) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.notify_status_defer_check_error',
        decision: 'notify_worker_status',
        outcome: 'error',
        reason: 'worker_status_lookup_failed',
        level: 'warn',
        error: getErrorMessage(err),
      });
      return false;
    }

    return (
      currentStatus === EWorkerStatus.creating ||
      currentStatus === EWorkerStatus.recreating
    );
  }

  async resolveIncomingCallAction(
    input: IResolveIncomingCallActionRequestProto
  ): Promise<IResolveIncomingCallActionResponseProto> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (!workerId || !accountId) {
      return { ...this.defaultCallAction };
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);
    if (!worker) {
      return { ...this.defaultCallAction };
    }

    const config =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);
    const showMessageTemplate = config?.show_message_on_call?.trim() ?? '';
    const callJid = input.call_jid?.trim() || null;
    const callPhone = input.call_phone?.trim() || null;
    let showMessageText = showMessageTemplate;

    if (showMessageTemplate.length > 0) {
      try {
        showMessageText = await this.buildIncomingCallMessageText(
          accountId,
          workerId,
          worker,
          showMessageTemplate,
          callJid,
          callPhone
        );
      } catch (error) {
        console.error(
          `[WorkerCommandHandler] Error building incoming call message for worker ${workerId}:`,
          error
        );
      }
    }

    return {
      reject_call: Boolean(config?.reject_call),
      show_message_on_call: showMessageText.trim().length > 0,
      show_message_text: showMessageText,
    };
  }

  async getTypingSimulationConfig(
    input: IGetTypingSimulationConfigRequestProto
  ): Promise<IGetTypingSimulationConfigResponseProto> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();

    if (!workerId || !accountId) {
      return defaultTypingSimulationConfig();
    }

    const worker = await this.workerService.viewWorker(accountId, workerId);
    if (!worker) {
      return defaultTypingSimulationConfig();
    }

    const config =
      await this.workerConfigService.viewTypingSimulation(workerId);
    await this.workerConfigService.refreshTypingSimulationCache(workerId);

    return config;
  }

  async registerS3BackupFallbackUpload(
    input: IRegisterS3BackupFallbackUploadRequestProto
  ): Promise<void> {
    const accountId = input.account_id?.trim();
    const bucket = input.bucket?.trim();
    const objectKey = input.object_key?.trim();

    if (!accountId || !bucket || !objectKey) {
      throw new Error(
        'Missing required fields: account_id, bucket, object_key'
      );
    }

    const parsedSize =
      typeof input.size_bytes === 'number'
        ? input.size_bytes
        : Number.parseInt(input.size_bytes ?? '0', 10);

    if (!Number.isFinite(parsedSize) || parsedSize < 0) {
      throw new Error('Invalid field: size_bytes');
    }

    const primaryAttempts =
      typeof input.primary_attempts === 'number' && input.primary_attempts > 0
        ? Math.trunc(input.primary_attempts)
        : 0;

    const backupAttempts =
      typeof input.backup_attempts === 'number' && input.backup_attempts > 0
        ? Math.trunc(input.backup_attempts)
        : 0;

    await this.s3BackupUploadService.registerFallbackUpload({
      account_id: accountId,
      bucket,
      object_key: objectKey,
      file_name: input.file_name?.trim() || null,
      content_type: input.content_type?.trim() || null,
      size_bytes: Math.trunc(parsedSize),
      primary_attempts: primaryAttempts,
      backup_attempts: backupAttempts,
      primary_error: input.primary_error?.trim() || null,
      backup_error: input.backup_error?.trim() || null,
    });
  }

  private buildFallbackChatForIncomingCall(
    accountId: string,
    worker: Awaited<ReturnType<WorkerService['viewWorker']>>,
    workerId: string,
    phone: string
  ): IChat {
    return {
      chat_id: `incoming_call:${workerId}:${phone || 'unknown'}`,
      account: {
        id: worker?.account?.id ?? accountId,
        name: worker?.account?.name ?? '',
      },
      worker: {
        id: worker?.id ?? workerId,
        name: worker?.name ?? '',
      },
      name: null,
      phone,
      status: EChatStatus.queue,
      date: new Date().toISOString(),
      user: null,
      sector: null,
      contact: null,
    };
  }

  private async buildIncomingCallMessageText(
    accountId: string,
    workerId: string,
    worker: Awaited<ReturnType<WorkerService['viewWorker']>>,
    template: string,
    callJid: string | null,
    callPhone: string | null
  ): Promise<string> {
    const normalizedPhone =
      callPhone?.replaceAll(/\D/g, '') || getPhoneFromJid(callJid, null) || '';

    let chat: IChat | null = null;
    if (normalizedPhone) {
      chat = await this.chatService.findChatByPhone(
        accountId,
        workerId,
        normalizedPhone,
        callJid,
        null
      );
    }

    let protocol: string | null = null;
    if (hasProtocolTag(template)) {
      if (chat) {
        protocol =
          (await this.chatService.getOrCreateChatProtocol(
            accountId,
            chat.chat_id,
            'protocol_start'
          )) ||
          this.chatService.getLatestProtocolByType(chat, 'protocol_start');
      }
    }

    const replacementChat =
      chat ??
      this.buildFallbackChatForIncomingCall(
        accountId,
        worker,
        workerId,
        normalizedPhone
      );

    return replaceMessageTags({
      message: template,
      chat: replacementChat,
      protocol,
    });
  }

  async validatePhone(
    input: IPhoneValidationRequest
  ): Promise<IPhoneValidationResponse> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const phone = input.phone?.trim();
    const phoneDdi = input.phone_ddi?.trim();

    if (!workerId || !accountId || !phone) {
      throw new Error('Missing required fields: worker_id, account_id, phone');
    }

    if (!phoneDdi) {
      throw new Error('Missing required field: phone_ddi');
    }

    const workerType = await this.resolveWorkerTypeForConnection(
      workerId,
      accountId
    );

    return this.workerBaileysGrpcClientService.validatePhone(
      workerId,
      {
        ...input,
        worker_id: workerId,
        account_id: accountId,
        phone,
        phone_ddi: phoneDdi,
      },
      workerType
    );
  }

  private startOnlineConnectionWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): void {
    this.stopConnectionRequestRetry(payload.worker_id);

    void this.runWithWorkerLifecycleLock(
      payload.worker_id,
      'change_status_online',
      () => this.runOnlineConnectionWorkflow(payload, accountId)
    ).catch((err) => {
      console.error('Worker online connection workflow failed:', {
        workerId: payload.worker_id,
        accountId,
        error: getErrorMessage(err),
      });

      void this.publishConnectionFailure(payload, accountId).catch(
        (publishErr) => {
          console.error('Failed to publish worker connection failure:', {
            workerId: payload.worker_id,
            accountId,
            error: getErrorMessage(publishErr),
          });
        }
      );
    });
  }

  private async runOnlineConnectionWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    const workerId = payload.worker_id;
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.online_workflow_start',
      decision: 'run_online_connection_workflow',
      outcome: 'started',
      status: payload.status,
      connection_type: payload.type,
    });
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );
    const workerType =
      workerData?.workerTypeId ??
      (await this.resolveWorkerTypeForConnection(workerId, accountId));

    const existsContainer =
      await this.workerService.existsContainerWorkerById(workerId);
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.container_check',
      decision: 'exists_container_worker_by_id',
      outcome: existsContainer ? 'exists' : 'missing',
      worker_type: workerType,
    });
    if (existsContainer) {
      const requested = await this.tryRequestConnection(
        workerId,
        payload,
        workerType
      );
      if (requested) {
        return;
      }

      const healthy = await this.isExistingContainerHealthy(workerId, {
        maxAttempts: 3,
        delayMs: 1000,
      });
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.container_health',
        decision: 'is_existing_container_healthy',
        outcome: healthy ? 'healthy' : 'unhealthy',
        worker_type: workerType,
      });
      if (healthy) {
        this.startConnectionRequestRetry(payload);
        return;
      }
    }

    if (!workerData) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.worker_data_validation',
        decision: 'resolve_worker_data_for_container',
        outcome: 'error',
        reason: 'worker_data_not_found',
        level: 'error',
      });
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.container_create_start',
      decision: 'create_worker_with_payload',
      outcome: 'started',
      worker_type: workerData.workerTypeId,
    });
    await this.createWorkerWithPayload(workerId, workerData, payload);
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.container_create_success',
      decision: 'create_worker_with_payload',
      outcome: 'success',
      worker_type: workerData.workerTypeId,
    });
  }

  private qrAttemptCacheKey(workerId: string): string {
    return `connection:qrcode:${workerId}:attempt`;
  }

  private activeQrAttemptKey(workerId: string): string {
    return `connection:qrcode:${workerId}:active_attempt`;
  }

  private qrGeneratedAtMs(
    state: Partial<IBaileysConnectionState>
  ): number | undefined {
    if (!state.qr_generated_at) {
      return undefined;
    }

    const parsed = Date.parse(state.qr_generated_at);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private qrAgeMs(state: Partial<IBaileysConnectionState>): number | undefined {
    const generatedAtMs = this.qrGeneratedAtMs(state);
    if (generatedAtMs === undefined) {
      return undefined;
    }

    return Math.max(0, Date.now() - generatedAtMs);
  }

  private isQrExpired(state: Partial<IBaileysConnectionState>): boolean {
    if (!state.qrcode) {
      return false;
    }

    const ageMs = this.qrAgeMs(state);
    return ageMs === undefined || ageMs >= this.qrMaxAgeMs;
  }

  private qrCacheTtlForState(state: IBaileysConnectionState): number {
    if (!state.qrcode) {
      return this.qrAttemptTtlSeconds;
    }

    const ageMs = this.qrAgeMs(state) ?? 0;
    const remainingSeconds = Math.max(
      1,
      Math.floor((this.qrMaxAgeMs - ageMs) / 1000)
    );

    return Math.min(this.qrCacheTtlSeconds, remainingSeconds);
  }

  private buildPendingStateFromExpiredQr(
    state: IBaileysConnectionState
  ): IBaileysConnectionState {
    const pending: IBaileysConnectionState = {
      ...state,
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      qr_pending: true,
    };
    delete pending.qrcode;
    delete pending.qr_generated_at;
    return pending;
  }

  private normalizeQrFreshness(
    state: IBaileysConnectionState
  ): IBaileysConnectionState {
    if (!state.qrcode) {
      return state;
    }

    const normalized: IBaileysConnectionState = { ...state };
    normalized.qr_generated_at ??= new Date().toISOString();

    if (!this.isQrExpired(normalized)) {
      normalized.qr_pending = false;
      return normalized;
    }

    return this.buildPendingStateFromExpiredQr(normalized);
  }

  private async getCachedQrAttemptState(
    workerId: string
  ): Promise<IBaileysConnectionState | undefined> {
    try {
      const raw = await this.redis.get(this.qrAttemptCacheKey(workerId));
      if (!raw) {
        return undefined;
      }

      const parsed = JSON.parse(raw) as Partial<IBaileysConnectionState>;
      if (!parsed.worker_id || parsed.worker_id !== workerId) {
        return undefined;
      }

      const state = parsed as IBaileysConnectionState;
      if (this.isQrExpired(state)) {
        const pending = this.buildPendingStateFromExpiredQr(state);
        const ttlSeconds = this.qrCacheTtlForState(pending);
        await this.redis.setex(
          this.qrAttemptCacheKey(workerId),
          ttlSeconds,
          JSON.stringify(pending)
        );
        recordConnectionQrSummary({
          event: 'balancer_qrcode_cache_expired',
          ...summarizeConnectionQrState(state),
          reason: 'qr_cache_age_exceeded',
          qr_age_ms: this.qrAgeMs(state),
          qr_cache_ttl_seconds: ttlSeconds,
          qr_expired: true,
          level: 'warn',
        });
        return pending;
      }

      return state;
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_cache_read_error',
        worker_id: workerId,
        reason: 'redis_cache_read_failed',
        error: getErrorMessage(err),
        level: 'warn',
      });
      return undefined;
    }
  }

  private isQrAttemptTerminalState(
    state: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      state.status === EBaileysConnectionStatus.connected ||
      state.status === EBaileysConnectionStatus.disconnected ||
      state.disconnected_user === true ||
      state.worker_status_id === EWorkerStatus.online ||
      state.worker_status_id === EWorkerStatus.error ||
      state.worker_status_id === EWorkerStatus.delete ||
      state.code === ECodeMessage.connectionEstablished ||
      state.code === ECodeMessage.logoutInProgress ||
      state.code === ECodeMessage.loggedOut ||
      state.code === ECodeMessage.connectionLost ||
      state.code === ECodeMessage.connectionClosed ||
      state.code === ECodeMessage.connectionReplaced ||
      state.code === ECodeMessage.badSession ||
      state.code === ECodeMessage.multideviceMismatch ||
      state.code === ECodeMessage.phoneNotAvailable
    );
  }

  private isActiveQrAttemptState(
    state: IBaileysConnectionState | undefined
  ): state is IBaileysConnectionState {
    return state !== undefined && !this.isQrAttemptTerminalState(state);
  }

  private async resolveQrRequestPayload(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<{
    payload: StatusConnectionWorkerRequest;
    cachedState?: IBaileysConnectionState;
    shouldReturnCached: boolean;
  }> {
    const cached = await this.getCachedQrAttemptState(input.worker_id);
    const workerData = cached
      ? await this.resolveWorkerDataForContainer(input.worker_id, accountId)
      : null;
    const cachedIdentityMismatch = cached
      ? this.getCachedQrIdentityMismatchReason(cached, workerData)
      : undefined;
    if (cached && cachedIdentityMismatch) {
      await this.redis.del(this.qrAttemptCacheKey(input.worker_id));
      recordConnectionQrSummary({
        event: 'balancer_qrcode_cached_attempt_invalidated',
        ...summarizeConnectionQrState(cached),
        worker_type: workerData?.workerTypeId,
        reason: cachedIdentityMismatch,
        runtime_generation: workerData?.runtimeGeneration,
        publish_source: 'qr_request_cache_validation',
        level: 'warn',
      });
    }

    const activeCached =
      this.isActiveQrAttemptState(cached) && !cachedIdentityMismatch
        ? cached
        : undefined;
    const activeRetry = this.qrConnectionRequestPayloads.has(input.worker_id);
    const connectionAttemptId =
      activeCached?.connection_attempt_id ??
      input.connection_attempt_id ??
      uuidv7();

    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: connectionAttemptId,
    };

    if (!activeCached) {
      return { payload, shouldReturnCached: false };
    }

    if (
      activeCached.qrcode ||
      activeCached.qr_pending === true ||
      activeRetry
    ) {
      const pendingReason = activeRetry
        ? 'active_retry_in_progress'
        : 'active_attempt_pending';

      recordConnectionQrSummary({
        event: activeCached.qrcode
          ? 'balancer_qrcode_active_attempt_cache_hit'
          : 'balancer_qrcode_active_attempt_pending',
        ...summarizeConnectionQrState(activeCached),
        reason: activeCached.qrcode ? 'active_attempt_has_qr' : pendingReason,
        qr_age_ms: this.qrAgeMs(activeCached),
        qr_cache_ttl_seconds: this.qrCacheTtlForState(activeCached),
        qr_expired: this.isQrExpired(activeCached),
        level: activeCached.qrcode ? 'info' : 'warn',
      });

      return {
        payload,
        cachedState: activeCached,
        shouldReturnCached: true,
      };
    }

    return {
      payload,
      cachedState: activeCached,
      shouldReturnCached: false,
    };
  }

  private getCachedQrIdentityMismatchReason(
    cached: IBaileysConnectionState,
    workerData: ResolvedWorkerDataForContainer | null
  ): string | undefined {
    if (!workerData) {
      return undefined;
    }

    if (!cached.worker_type_id) {
      return 'cached_qr_missing_worker_type';
    }

    if (cached.worker_type_id !== workerData.workerTypeId) {
      return 'cached_qr_worker_type_mismatch';
    }

    if (
      cached.runtime_generation !== undefined &&
      workerData.runtimeGeneration !== undefined &&
      cached.runtime_generation !== workerData.runtimeGeneration
    ) {
      return 'cached_qr_runtime_generation_mismatch';
    }

    return undefined;
  }

  private ensureQrConnectionAttemptId(
    payload: StatusConnectionWorkerRequest
  ): string {
    if (!payload.connection_attempt_id) {
      payload.connection_attempt_id = uuidv7();
    }

    return payload.connection_attempt_id;
  }

  private buildQrPendingState(
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    options: {
      attempt?: number;
      maxAttempts?: number;
      reason?: string;
      runtimeGeneration?: number;
      warmPoolId?: string | null;
      containerId?: string | null;
    } = {}
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: accountId,
      connection_attempt_id: this.ensureQrConnectionAttemptId(payload),
      qr_pending: true,
      reason: options.reason,
      runtime_generation: options.runtimeGeneration,
      warm_pool_id: options.warmPoolId ?? undefined,
      container_id: options.containerId ?? undefined,
      ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
      ...(options.maxAttempts !== undefined
        ? { max_attempts: options.maxAttempts }
        : {}),
    };
  }

  private buildQrPendingStateFromState(
    state: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): IBaileysConnectionState {
    const pending: IBaileysConnectionState = {
      ...state,
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: state.account_id || accountId || '',
      connection_attempt_id:
        state.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      qr_pending: true,
      reason: state.reason ?? 'queued',
    };
    delete pending.qrcode;
    delete pending.pairing_code;
    delete pending.qr_generated_at;
    return pending;
  }

  private buildQrReadyStateFromState(
    state: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): IBaileysConnectionState {
    return {
      ...state,
      code: state.code ?? ECodeMessage.awaitingReadQrCode,
      status: state.status ?? EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: state.account_id || accountId || '',
      connection_attempt_id:
        state.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      qr_pending: false,
      reason: state.reason ?? 'cached_qr_available',
    };
  }

  private normalizeQrWorkerResponse(
    response: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    workerData?: ResolvedWorkerDataForContainer
  ): IBaileysConnectionState {
    const normalized: IBaileysConnectionState = {
      ...response,
      worker_id: response.worker_id || payload.worker_id,
      account_id: response.account_id || accountId,
      worker_type_id: response.worker_type_id ?? workerData?.workerTypeId,
      worker_status_id: response.worker_status_id ?? workerData?.workerStatusId,
      connection_attempt_id:
        response.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
      connection_lifecycle_id:
        response.connection_lifecycle_id ?? payload.connection_lifecycle_id,
      runtime_generation:
        response.runtime_generation ??
        payload.runtime_generation ??
        workerData?.runtimeGeneration,
      warm_pool_id:
        response.warm_pool_id ??
        payload.warm_pool_id ??
        workerData?.warmPoolId ??
        undefined,
      container_id:
        response.container_id ?? workerData?.containerId ?? undefined,
    };

    if (normalized.qrcode) {
      normalized.qr_pending = false;
      return normalized;
    }

    if (
      normalized.status !== EBaileysConnectionStatus.connected &&
      normalized.code !== ECodeMessage.connectionEstablished
    ) {
      normalized.qr_pending = true;
      normalized.reason ??= 'worker_response_without_qr';
      normalized.code = ECodeMessage.awaitingReadQrCode;
      normalized.status = EBaileysConnectionStatus.connecting;
    }

    return normalized;
  }

  private applyProxyDecisionToState(
    state: IBaileysConnectionState,
    proxyDecision: QrProxyDecision
  ): void {
    state.proxy_status = proxyDecision.status;
    if (proxyDecision.errorCode) {
      state.proxy_error_code = proxyDecision.errorCode;
    }
    if (proxyDecision.fallbackDirect) {
      state.proxy_fallback = 'direct';
      state.proxy_bypassed = true;
    }
  }

  private async cacheQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<void> {
    const ttlSeconds = this.qrCacheTtlForState(state);
    await this.redis.setex(
      this.qrAttemptCacheKey(state.worker_id),
      ttlSeconds,
      JSON.stringify(state)
    );
  }

  private async invalidateQrAttemptState(
    workerId: string,
    options: {
      accountId?: string;
      workerType?: EWorkerType;
      reason: string;
      recreateReason?: string;
    }
  ): Promise<void> {
    this.stopQrConnectionAttemptRetry(workerId);

    try {
      await this.redis.del(
        this.qrAttemptCacheKey(workerId),
        this.activeQrAttemptKey(workerId)
      );
      recordConnectionQrSummary({
        event: 'balancer_qrcode_attempt_invalidated',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
        publish_source: 'recreate_worker',
        level: 'info',
      });
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_attempt_invalidate_error',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
        error: getErrorMessage(err),
        publish_source: 'recreate_worker',
        level: 'warn',
      });
    }
  }

  private async shouldIgnoreQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<{ ignored: boolean; reason?: string }> {
    if (this.isQrAttemptTerminalState(state)) {
      return { ignored: false };
    }

    const cached = await this.getCachedQrAttemptState(state.worker_id);
    if (!this.isActiveQrAttemptState(cached)) {
      return { ignored: false };
    }

    if (!this.isNotifyQrAttemptState(state)) {
      return { ignored: false };
    }

    const cachedAttempt = cached.connection_attempt_id;
    const incomingAttempt = state.connection_attempt_id;

    if (
      cached.worker_type_id &&
      state.worker_type_id &&
      cached.worker_type_id !== state.worker_type_id
    ) {
      return {
        ignored: true,
        reason: 'active_worker_type_mismatch',
      };
    }

    if (
      cached.runtime_generation !== undefined &&
      state.runtime_generation !== undefined &&
      cached.runtime_generation !== state.runtime_generation
    ) {
      return {
        ignored: true,
        reason: 'active_runtime_generation_mismatch',
      };
    }

    if (cachedAttempt && incomingAttempt && cachedAttempt !== incomingAttempt) {
      return {
        ignored: true,
        reason: 'active_attempt_mismatch',
      };
    }

    if (cached.qrcode && !state.qrcode) {
      return {
        ignored: true,
        reason: 'cached_qr_wins_over_without_qr',
      };
    }

    return { ignored: false };
  }

  private async cacheAndPublishQrAttemptState(
    state: IBaileysConnectionState,
    options: {
      event: string;
      workerType?: EWorkerType;
      reason?: string;
      error?: string;
      recreateReason?: string;
      timeToFirstQrMs?: number;
      publishSource?: string;
      level?: 'info' | 'warn' | 'error';
    }
  ): Promise<boolean> {
    const stateWithIdentity = await this.hydrateQrAttemptIdentity(state);
    if (options.workerType && !stateWithIdentity.worker_type_id) {
      stateWithIdentity.worker_type_id = options.workerType;
    }
    if (
      options.workerType &&
      stateWithIdentity.worker_type_id &&
      stateWithIdentity.worker_type_id !== options.workerType
    ) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_state_ignored_type_mismatch',
        ...summarizeConnectionQrState(stateWithIdentity),
        worker_type: options.workerType,
        reason: 'incoming_worker_type_mismatch',
        publish_source: options.publishSource ?? options.event,
        level: 'warn',
      });
      return false;
    }
    const normalizedState = this.normalizeQrFreshness(stateWithIdentity);
    const ttlSeconds = this.qrCacheTtlForState(normalizedState);
    const stale = await this.shouldIgnoreQrAttemptState(normalizedState);
    if (stale.ignored) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_state_ignored_stale',
        ...summarizeConnectionQrState(normalizedState),
        worker_type: options.workerType,
        reason: stale.reason,
        container_id: normalizedState.container_id,
        runtime_generation: normalizedState.runtime_generation,
        warm_pool_id: normalizedState.warm_pool_id,
        publish_source: options.publishSource ?? options.event,
        ignored_stale: true,
        qr_age_ms: this.qrAgeMs(normalizedState),
        qr_cache_ttl_seconds: ttlSeconds,
        qr_expired: this.isQrExpired(normalizedState),
        level: 'warn',
      });
      return false;
    }

    try {
      await this.cacheQrAttemptState(normalizedState);
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_cache_error',
        ...summarizeConnectionQrState(normalizedState),
        worker_type: options.workerType,
        reason: 'redis_cache_failed',
        error: getErrorMessage(err),
        container_id: normalizedState.container_id,
        runtime_generation: normalizedState.runtime_generation,
        warm_pool_id: normalizedState.warm_pool_id,
        qr_age_ms: this.qrAgeMs(normalizedState),
        qr_cache_ttl_seconds: ttlSeconds,
        qr_expired: this.isQrExpired(normalizedState),
        level: 'error',
      });
    }

    recordConnectionQrSummary({
      event: options.event,
      ...summarizeConnectionQrState(normalizedState),
      worker_type: options.workerType,
      reason: normalizedState.reason ?? options.reason,
      error: options.error,
      recreate_reason: options.recreateReason,
      time_to_first_qr_ms: options.timeToFirstQrMs,
      container_id: normalizedState.container_id,
      runtime_generation: normalizedState.runtime_generation,
      warm_pool_id: normalizedState.warm_pool_id,
      qr_age_ms: this.qrAgeMs(normalizedState),
      qr_cache_ttl_seconds: ttlSeconds,
      qr_expired: this.isQrExpired(normalizedState),
      publish_source: options.publishSource ?? options.event,
      level: options.level,
    });

    if (normalizedState.account_id) {
      try {
        await this.centrifugoPublish(normalizedState);
      } catch (err) {
        recordConnectionQrSummary({
          event: 'balancer_qrcode_publish_error',
          ...summarizeConnectionQrState(normalizedState),
          worker_type: options.workerType,
          reason: 'centrifugo_publish_failed',
          error: getErrorMessage(err),
          publish_source: options.publishSource ?? options.event,
          qr_age_ms: this.qrAgeMs(normalizedState),
          qr_cache_ttl_seconds: ttlSeconds,
          qr_expired: this.isQrExpired(normalizedState),
          level: 'error',
        });
      }
    }

    return true;
  }

  private async hydrateQrAttemptIdentity(
    state: IBaileysConnectionState
  ): Promise<IBaileysConnectionState> {
    if (state.connection_attempt_id && state.connection_lifecycle_id) {
      return state;
    }

    try {
      const raw = await this.redis.get(
        this.activeQrAttemptKey(state.worker_id)
      );
      if (!raw) {
        return state;
      }

      const parsed = JSON.parse(raw) as {
        ack?: Partial<IBaileysConnectionState>;
        worker_type_id?: EWorkerType;
      };
      const ack = parsed.ack;
      if (!ack || ack.worker_id !== state.worker_id) {
        return state;
      }

      const hydrated: IBaileysConnectionState = {
        ...state,
        connection_attempt_id:
          state.connection_attempt_id ?? ack.connection_attempt_id,
        connection_lifecycle_id:
          state.connection_lifecycle_id ?? ack.connection_lifecycle_id,
        worker_type_id:
          state.worker_type_id ?? ack.worker_type_id ?? parsed.worker_type_id,
      };

      if (
        hydrated.connection_attempt_id !== state.connection_attempt_id ||
        hydrated.connection_lifecycle_id !== state.connection_lifecycle_id
      ) {
        recordConnectionQrSummary({
          event: 'balancer_qrcode_attempt_identity_hydrated',
          ...summarizeConnectionQrState(hydrated),
          reason: 'active_attempt_identity_used',
          publish_source: 'notify_worker_status',
          level: 'info',
        });
      }

      return hydrated;
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_attempt_identity_hydration_error',
        ...summarizeConnectionQrState(state),
        reason: 'active_attempt_identity_read_failed',
        error: getErrorMessage(err),
        publish_source: 'notify_worker_status',
        level: 'warn',
      });
      return state;
    }
  }

  private isRetryableQrRequestError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    const code =
      error && typeof error === 'object' && 'code' in error
        ? Number((error as { code?: unknown }).code)
        : undefined;

    return (
      code === 4 ||
      code === 14 ||
      message.includes('deadline') ||
      message.includes('deadline_exceeded') ||
      message.includes('unavailable') ||
      message.includes('failed to connect before the deadline') ||
      message.includes('econnrefused') ||
      message.includes('no connection established') ||
      message.includes('name resolution') ||
      message.includes('enotfound')
    );
  }

  private startQrConnectionAttemptRetry(
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    workerData: ResolvedWorkerDataForContainer
  ): void {
    const existingStartedAtMs = this.qrConnectionRequestPayloads.get(
      payload.worker_id
    )?.startedAtMs;
    this.stopQrConnectionAttemptRetry(payload.worker_id);
    this.rememberQrConnectionAttempt(
      payload,
      accountId,
      workerData,
      existingStartedAtMs
    );
    this.qrConnectionRequestAttempts.set(payload.worker_id, 0);
    this.scheduleNextQrConnectionAttempt(payload.worker_id);
  }

  private rememberQrConnectionAttempt(
    payload: StatusConnectionWorkerRequest,
    accountId: string,
    workerData: ResolvedWorkerDataForContainer,
    startedAtMs = Date.now()
  ): void {
    this.qrConnectionRequestPayloads.set(payload.worker_id, {
      payload: { ...payload },
      accountId,
      workerData,
      startedAtMs,
    });
  }

  private async resumePendingQrAttempt(
    payload: StatusConnectionWorkerRequest,
    cachedState: IBaileysConnectionState,
    accountId?: string
  ): Promise<void> {
    try {
      const workerData = await this.resolveWorkerDataForContainer(
        payload.worker_id,
        accountId ?? cachedState.account_id
      );

      if (!workerData) {
        recordConnectionQrSummary({
          event: 'balancer_qrcode_pending_resume_skipped',
          ...summarizeConnectionQrState(cachedState),
          reason: 'worker_data_not_found',
          level: 'warn',
        });
        return;
      }

      this.startQrConnectionAttemptRetry(
        payload,
        accountId || cachedState.account_id || workerData.accountIdResolved,
        workerData
      );
      recordConnectionQrSummary({
        event: 'balancer_qrcode_pending_resume_scheduled',
        ...summarizeConnectionQrState(cachedState),
        worker_type: workerData.workerTypeId,
        reason: 'active_pending_without_in_memory_retry',
        publish_source: 'qr_pending_resume',
        level: 'warn',
      });
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_pending_resume_error',
        ...summarizeConnectionQrState(cachedState),
        reason: 'resume_pending_retry_failed',
        error: getErrorMessage(err),
        level: 'error',
      });
    }
  }

  private stopQrConnectionAttemptRetry(workerId: string): void {
    const timer = this.qrConnectionRequestTimers.get(workerId);
    if (timer) {
      clearTimeout(timer);
      this.qrConnectionRequestTimers.delete(workerId);
    }
    this.qrConnectionRequestPayloads.delete(workerId);
    this.qrConnectionRequestAttempts.delete(workerId);
  }

  private scheduleNextQrConnectionAttempt(workerId: string): void {
    const timer = setTimeout(() => {
      void this.runQrConnectionAttempt(workerId);
    }, this.qrRetryIntervalMs);
    this.qrConnectionRequestTimers.set(workerId, timer);
  }

  private async runQrConnectionAttempt(workerId: string): Promise<void> {
    const context = this.qrConnectionRequestPayloads.get(workerId);
    if (!context) {
      return;
    }

    const attempt = (this.qrConnectionRequestAttempts.get(workerId) ?? 0) + 1;
    this.qrConnectionRequestAttempts.set(workerId, attempt);

    if (attempt > this.qrRetryMaxAttempts) {
      const pending = this.buildQrPendingState(
        context.payload,
        context.accountId,
        {
          attempt: this.qrRetryMaxAttempts,
          maxAttempts: this.qrRetryMaxAttempts,
          reason: 'retry_exhausted',
          runtimeGeneration: context.workerData.runtimeGeneration,
          warmPoolId: context.workerData.warmPoolId,
          containerId: context.workerData.containerId,
        }
      );
      await this.cacheAndPublishQrAttemptState(pending, {
        event: 'balancer_qrcode_retry_exhausted',
        workerType: context.workerData.workerTypeId,
        reason: 'retry_exhausted',
        publishSource: 'qr_retry',
        level: 'warn',
      });
      this.stopQrConnectionAttemptRetry(workerId);
      return;
    }

    const pending = this.buildQrPendingState(
      context.payload,
      context.accountId,
      {
        attempt,
        maxAttempts: this.qrRetryMaxAttempts,
        reason: 'legacy_grpc_qr_retry_disabled',
        runtimeGeneration: context.workerData.runtimeGeneration,
        warmPoolId: context.workerData.warmPoolId,
        containerId: context.workerData.containerId,
      }
    );
    await this.cacheAndPublishQrAttemptState(pending, {
      event: 'balancer_qrcode_legacy_retry_disabled',
      workerType: context.workerData.workerTypeId,
      reason: 'connection_qrcode_requests_are_queue_driven',
      publishSource: 'qr_retry_disabled',
      level: 'warn',
    });
    this.stopQrConnectionAttemptRetry(workerId);
  }

  private async runConnectionQrCodeWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    const workerId = payload.worker_id;
    this.ensureQrConnectionAttemptId(payload);
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_workflow_start',
      decision: 'run_connection_qrcode_workflow',
      outcome: 'started',
      status: payload.status,
      connection_type: payload.type,
      connection_attempt_id: payload.connection_attempt_id,
    });
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );

    if (!workerData) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.qrcode_worker_data_validation',
        decision: 'resolve_worker_data_for_container',
        outcome: 'error',
        reason: 'worker_data_not_found',
        level: 'error',
      });
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_worker_data_resolved',
      decision: 'resolve_worker_data_for_container',
      outcome: 'success',
      account_id: workerData.accountIdResolved,
      server_id: workerData.serverId,
      server_name: workerData.serverName,
      server_web_domain: workerData.serverWebDomain,
      worker_type: workerData.workerTypeId,
      worker_type_name: workerData.workerTypeName,
      worker_status_id: workerData.workerStatusId,
      container_id: workerData.containerId,
      lifecycle_operation_id: workerData.lifecycleOperationId,
    });

    const pending = this.buildQrPendingState(
      payload,
      workerData.accountIdResolved,
      {
        reason: 'qrcode_fastpath_grpc_start',
        runtimeGeneration: workerData.runtimeGeneration,
        warmPoolId: workerData.warmPoolId,
        containerId: workerData.containerId,
      }
    );

    await this.cacheAndPublishQrAttemptState(pending, {
      event: 'balancer_qrcode_fastpath_pending',
      workerType: workerData.workerTypeId,
      reason: 'qrcode_fastpath_grpc_start',
      publishSource: 'qr_fastpath',
      level: 'info',
    });
    this.stopQrConnectionAttemptRetry(workerId);

    const directPayload: StatusConnectionWorkerRequest = {
      ...payload,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      qr_pending: true,
    };

    try {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.qrcode_fastpath_start',
        decision: 'grpc_request_worker_qrcode',
        outcome: 'started',
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        connection_attempt_id: directPayload.connection_attempt_id,
        connection_lifecycle_id: directPayload.connection_lifecycle_id,
        runtime_generation: directPayload.runtime_generation,
        warm_pool_id: directPayload.warm_pool_id,
        container_id: workerData.containerId,
      });

      const response =
        await this.workerBaileysGrpcClientService.requestConnectionQrCode(
          workerId,
          directPayload,
          workerData.workerTypeId
        );
      const normalized = this.normalizeQrWorkerResponse(
        response,
        directPayload,
        workerData.accountIdResolved,
        workerData
      );

      await this.cacheAndPublishQrAttemptState(normalized, {
        event: normalized.qrcode
          ? 'balancer_qrcode_fastpath_generated'
          : 'balancer_qrcode_fastpath_worker_pending',
        workerType: workerData.workerTypeId,
        reason: normalized.reason ?? 'qrcode_fastpath_grpc_response',
        timeToFirstQrMs: normalized.time_to_first_qr_ms,
        publishSource: 'qr_fastpath',
        level: normalized.qrcode ? 'info' : 'warn',
      });

      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.qrcode_fastpath_success',
        decision: 'grpc_request_worker_qrcode',
        outcome: 'success',
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        status: normalized.status,
        code: normalized.code,
        connection_attempt_id: normalized.connection_attempt_id,
        connection_lifecycle_id: normalized.connection_lifecycle_id,
        has_qr: Boolean(normalized.qrcode),
        has_pairing_code: Boolean(normalized.pairing_code),
        qr_pending: normalized.qr_pending === true,
        runtime_generation: normalized.runtime_generation,
        warm_pool_id: normalized.warm_pool_id,
        container_id: normalized.container_id,
      });

      return normalized;
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.qrcode_fastpath_error',
        decision: 'grpc_request_worker_qrcode',
        outcome: 'error',
        reason: 'worker_qrcode_grpc_failed',
        level: this.isRetryableQrRequestError(err) ? 'warn' : 'error',
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        connection_attempt_id: directPayload.connection_attempt_id,
        connection_lifecycle_id: directPayload.connection_lifecycle_id,
        runtime_generation: directPayload.runtime_generation,
        warm_pool_id: directPayload.warm_pool_id,
        container_id: workerData.containerId,
        error: getErrorMessage(err),
      });

      if (this.isRetryableQrRequestError(err)) {
        throw err;
      }

      return pending;
    }
  }

  private async ensureQrContainerReady(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<QrProxyDecision> {
    const proxyDecision = await this.resolveQrProxyDecision(
      workerId,
      workerData
    );

    if (
      !proxyDecision.fallbackDirect &&
      (workerData.workerStatusId === EWorkerStatus.creating ||
        workerData.workerStatusId === EWorkerStatus.recreating)
    ) {
      const ready = await this.waitForExistingQrContainerReady(
        workerId,
        workerData,
        { maxAttempts: 10, delayMs: 2000, grpcReadyTimeoutMs: 2000 }
      );
      if (ready) {
        return proxyDecision;
      }
    }

    const inspection = await this.inspectWorkerContainerForQr(
      workerId,
      workerData
    );
    let recreateReason = this.qrContainerRecreateReason(inspection);

    if (inspection.exists && inspection.running === true) {
      const compatibilityIssue = this.qrContainerCompatibilityIssue(
        workerId,
        workerData,
        inspection
      );

      if (compatibilityIssue) {
        recreateReason = compatibilityIssue;
        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.qrcode_container_incompatible',
          decision: 'validate_existing_container_compatibility',
          outcome: 'incompatible',
          reason: compatibilityIssue,
          recreate_reason: compatibilityIssue,
          level: 'warn',
          worker_type: workerData.workerTypeId,
          expected_image: getImageWorker(workerData.workerTypeId),
          expected_grpc_port: this.getExpectedWorkerGrpcPort(
            workerData.workerTypeId
          ),
          ...this.lifecycleFieldsFromInspection(inspection),
        });
      } else if (
        proxyDecision.fallbackDirect &&
        this.containerHasProxy(inspection)
      ) {
        recreateReason = 'proxy_unhealthy_direct_fallback';
        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.qrcode_container_proxy_unhealthy',
          decision: 'validate_existing_container_proxy',
          outcome: 'unhealthy',
          reason: recreateReason,
          recreate_reason: recreateReason,
          level: 'warn',
          worker_type: workerData.workerTypeId,
          proxy_status: proxyDecision.status,
          proxy_error_code: proxyDecision.errorCode,
          proxy_fallback: 'direct',
          ...this.lifecycleFieldsFromInspection(inspection),
        });
      } else {
        const containerId = inspection.container_id ?? workerId;
        const healthy = await this.isExistingContainerHealthy(containerId, {
          maxAttempts: 2,
          delayMs: 1000,
          requiredConsecutiveSuccesses: 1,
        });
        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.qrcode_existing_container_health',
          decision: 'is_existing_container_healthy',
          outcome: healthy ? 'healthy' : 'unhealthy',
          reason: healthy ? undefined : 'existing_container_health_failed',
          recreate_reason: healthy
            ? undefined
            : 'existing_container_health_failed',
          worker_type: workerData.workerTypeId,
          ...this.lifecycleFieldsFromInspection(inspection),
        });

        if (healthy) {
          try {
            await this.waitForWorkerGrpcReady(
              workerId,
              workerData.workerTypeId
            );
            return proxyDecision;
          } catch (err) {
            recordConnectionLifecycle({
              stage:
                'connection.balancer.command_handler.qrcode_existing_container_grpc_unready',
              decision: 'wait_worker_grpc_ready',
              outcome: 'not_ready',
              reason: 'healthy_container_grpc_not_ready',
              recreate_reason: 'container_grpc_not_ready',
              level: 'warn',
              worker_type: workerData.workerTypeId,
              error: getErrorMessage(err),
              ...this.lifecycleFieldsFromInspection(inspection),
            });
            recreateReason = 'container_grpc_not_ready';
          }
        } else {
          const grpcReadyAfterHealthFailure =
            await this.tryExistingWorkerGrpcReady(workerId, workerData, {
              timeoutMs: 5_000,
              reason: 'existing_container_health_failed',
            });

          if (grpcReadyAfterHealthFailure) {
            recordConnectionLifecycle({
              stage:
                'connection.balancer.command_handler.qrcode_existing_container_grpc_ready_after_health_failure',
              decision: 'reuse_existing_container',
              outcome: 'ready',
              reason: 'grpc_ready_after_http_health_failed',
              worker_type: workerData.workerTypeId,
              ...this.lifecycleFieldsFromInspection(inspection),
            });
            return proxyDecision;
          }

          recreateReason = 'existing_container_health_failed';
        }
      }
    }

    if (inspection.exists) {
      await this.recordContainerDiagnosticsSafely(workerId, recreateReason);
    }

    if (
      this.shouldSuppressQrContainerRecreate(
        workerId,
        workerData,
        recreateReason,
        inspection
      )
    ) {
      return proxyDecision;
    }

    if (
      inspection.exists &&
      this.shouldResetQrVolumeForRecreateReason(recreateReason, workerData)
    ) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.qrcode_container_volume_reset',
        decision: 'remove_incompatible_worker_volume',
        outcome: 'started',
        reason: recreateReason,
        recreate_reason: recreateReason,
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        ...this.lifecycleFieldsFromInspection(inspection),
      });
      recordConnectionQrSummary({
        event: 'balancer_qrcode_container_volume_reset',
        worker_id: workerId,
        account_id: workerData.accountIdResolved,
        worker_type: workerData.workerTypeId,
        recreate_reason: recreateReason,
        reason: 'incompatible_container_for_qr',
        level: 'warn',
      });
      await this.workerService.cleanupContainerWorker(workerId, true);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_container_recreate',
      decision: 'create_worker_with_payload',
      outcome: 'started',
      reason: recreateReason,
      recreate_reason: recreateReason,
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      ...this.lifecycleFieldsFromInspection(inspection),
    });
    this.markQrContainerRecreateCooldown(workerId, recreateReason);
    recordConnectionAttemptTelemetry({
      event: 'balancer_qrcode_container_recreate',
      stage: 'connection.balancer.command_handler.qrcode_container_recreate',
      metric_event: 'container_recreate',
      level: 'warn',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      server_id: workerData.serverId,
      worker_type: workerData.workerTypeId,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      container_id: inspection.container_id,
      container_name: inspection.container_name,
      outcome: 'started',
      reason: recreateReason,
      recreate_reason: recreateReason,
    });

    await this.createWorkerWithPayload(workerId, workerData, undefined, {
      healthOptions: {
        maxAttempts: 30,
        delayMs: 1000,
        requiredConsecutiveSuccesses: 3,
      },
      proxyOverride: proxyDecision.fallbackDirect ? null : proxyDecision.proxy,
      proxyMode: proxyDecision.fallbackDirect
        ? 'direct_fallback'
        : proxyDecision.proxy
          ? 'proxy'
          : 'direct',
    });

    const createdInspection = await this.inspectWorkerContainerForQr(
      workerId,
      workerData
    );
    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.qrcode_container_recreate_success',
      decision: 'create_worker_with_payload',
      outcome: 'success',
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      ...this.lifecycleFieldsFromInspection(createdInspection),
    });

    return proxyDecision;
  }

  private shouldResetQrVolumeForRecreateReason(
    recreateReason: string,
    workerData: ResolvedWorkerDataForContainer
  ): boolean {
    if (workerData.workerStatusId === EWorkerStatus.online) {
      return false;
    }

    return [
      'image_mismatch',
      'worker_type_mismatch',
      'worker_grpc_port_mismatch',
    ].includes(recreateReason);
  }

  private async waitForExistingQrContainerReady(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    options: {
      maxAttempts: number;
      delayMs: number;
      grpcReadyTimeoutMs: number;
    }
  ): Promise<boolean> {
    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.qrcode_wait_existing_container_start',
      decision: 'wait_existing_container_ready',
      outcome: 'started',
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      max_attempts: options.maxAttempts,
      health_delay_ms: options.delayMs,
    });

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      const inspection = await this.inspectWorkerContainerForQr(
        workerId,
        workerData
      );
      const containerId = inspection.container_id ?? workerId;
      const healthy =
        inspection.exists && inspection.running === true
          ? await this.isExistingContainerHealthy(containerId, {
              maxAttempts: 1,
              delayMs: 0,
            })
          : false;

      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.qrcode_wait_existing_container_attempt',
        decision: 'wait_existing_container_ready',
        outcome: healthy ? 'healthy' : 'unhealthy',
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        attempt,
        max_attempts: options.maxAttempts,
        health_delay_ms: options.delayMs,
        ...this.lifecycleFieldsFromInspection(inspection),
      });

      if (healthy) {
        try {
          await this.workerBaileysGrpcClientService.waitForReady(
            workerId,
            workerData.workerTypeId,
            options.grpcReadyTimeoutMs
          );
          return true;
        } catch {
          // Keep waiting while another recreate/create request is still booting.
        }
      }

      if (attempt < options.maxAttempts) {
        await this.sleep(options.delayMs);
      }
    }

    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.qrcode_wait_existing_container_timeout',
      decision: 'wait_existing_container_ready',
      outcome: 'timeout',
      reason: 'container_not_ready_during_worker_create_or_recreate',
      level: 'warn',
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      max_attempts: options.maxAttempts,
      health_delay_ms: options.delayMs,
    });

    return false;
  }

  private async tryExistingWorkerGrpcReady(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    options: { timeoutMs: number; reason: string }
  ): Promise<boolean> {
    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.qrcode_existing_container_grpc_probe_start',
      decision: 'wait_worker_grpc_ready',
      outcome: 'started',
      reason: options.reason,
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      deadline_ms: options.timeoutMs,
    });

    try {
      const grpcAddress =
        await this.workerBaileysGrpcClientService.waitForReady(
          workerId,
          workerData.workerTypeId,
          options.timeoutMs
        );
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.qrcode_existing_container_grpc_probe_success',
        decision: 'wait_worker_grpc_ready',
        outcome: 'ready',
        reason: options.reason,
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        grpc_address: grpcAddress,
        grpc_probe_address: grpcAddress,
        grpc_ready: true,
        deadline_ms: options.timeoutMs,
      });
      return true;
    } catch (err) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.qrcode_existing_container_grpc_probe_error',
        decision: 'wait_worker_grpc_ready',
        outcome: 'not_ready',
        reason: options.reason,
        level: 'warn',
        worker_type: workerData.workerTypeId,
        worker_status_id: workerData.workerStatusId,
        grpc_ready: false,
        deadline_ms: options.timeoutMs,
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  private async inspectWorkerContainerForQr(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<WorkerContainerInspection> {
    const inspection =
      await this.workerService.inspectContainerWorkerById(workerId);
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_container_inspected',
      decision: 'inspect_container_worker_by_id',
      outcome: inspection.exists ? 'exists' : 'missing',
      worker_type: workerData.workerTypeId,
      worker_status_id: workerData.workerStatusId,
      ...this.lifecycleFieldsFromInspection(inspection),
    });

    return inspection;
  }

  private lifecycleFieldsFromInspection(
    inspection: WorkerContainerInspection
  ): Record<string, string | number | boolean | undefined> {
    return {
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
      container_label_worker_id:
        inspection.container_labels?.['underchat.worker_id'],
      container_label_account_id:
        inspection.container_labels?.['underchat.account_id'],
      container_label_worker_type_id:
        inspection.container_labels?.['underchat.worker_type_id'],
      container_label_worker_image:
        inspection.container_labels?.['underchat.worker_image'],
      container_label_server_id:
        inspection.container_labels?.['underchat.server_id'],
      container_label_worker_grpc_port:
        inspection.container_labels?.['underchat.worker_grpc_port'],
      container_env_worker_id: inspection.container_env?.WORKER_ID,
      container_env_account_id: inspection.container_env?.ACCOUNT_ID,
      container_env_worker_type_id: inspection.container_env?.WORKER_TYPE_ID,
      container_env_worker_image: inspection.container_env?.WORKER_IMAGE,
      container_env_worker_grpc_port:
        inspection.container_env?.WORKER_GRPC_PORT,
      container_running: inspection.running,
    };
  }

  private qrContainerRecreateReason(
    inspection: WorkerContainerInspection
  ): string {
    if (!inspection.exists) {
      return 'container_missing';
    }
    if (inspection.running !== true) {
      return 'container_not_running';
    }
    return 'container_unhealthy';
  }

  private qrContainerCompatibilityIssue(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    inspection: WorkerContainerInspection
  ): string | undefined {
    const expectedImage = getImageWorker(workerData.workerTypeId);
    const expectedGrpcPort = this.getExpectedWorkerGrpcPort(
      workerData.workerTypeId
    );
    const expectedGrpcPortValue =
      expectedGrpcPort === undefined ? undefined : String(expectedGrpcPort);
    const labels = inspection.container_labels ?? {};
    const env = inspection.container_env ?? {};

    if (
      inspection.container_image &&
      inspection.container_image !== expectedImage
    ) {
      return 'image_mismatch';
    }

    if (
      labels['underchat.worker_image'] &&
      labels['underchat.worker_image'] !== expectedImage
    ) {
      return 'image_mismatch';
    }

    if (env.WORKER_IMAGE && env.WORKER_IMAGE !== expectedImage) {
      return 'image_mismatch';
    }

    if (
      labels['underchat.worker_id'] &&
      labels['underchat.worker_id'] !== workerId
    ) {
      return 'worker_id_mismatch';
    }

    if (env.WORKER_ID && env.WORKER_ID !== workerId) {
      return 'worker_id_mismatch';
    }

    if (
      labels['underchat.account_id'] &&
      labels['underchat.account_id'] !== workerData.accountIdResolved
    ) {
      return 'account_id_mismatch';
    }

    if (env.ACCOUNT_ID && env.ACCOUNT_ID !== workerData.accountIdResolved) {
      return 'account_id_mismatch';
    }

    if (
      labels['underchat.worker_type_id'] &&
      labels['underchat.worker_type_id'] !== workerData.workerTypeId
    ) {
      return 'worker_type_mismatch';
    }

    if (env.WORKER_TYPE_ID && env.WORKER_TYPE_ID !== workerData.workerTypeId) {
      return 'worker_type_mismatch';
    }

    if (
      labels['underchat.worker_grpc_port'] &&
      expectedGrpcPortValue !== undefined &&
      labels['underchat.worker_grpc_port'] !== expectedGrpcPortValue
    ) {
      return 'worker_grpc_port_mismatch';
    }

    if (
      env.WORKER_GRPC_PORT &&
      expectedGrpcPortValue !== undefined &&
      env.WORKER_GRPC_PORT !== expectedGrpcPortValue
    ) {
      return 'worker_grpc_port_mismatch';
    }

    return undefined;
  }

  private isHardQrContainerRecreateReason(reason: string): boolean {
    return [
      'container_missing',
      'container_not_running',
      'image_mismatch',
      'worker_id_mismatch',
      'account_id_mismatch',
      'worker_type_mismatch',
      'worker_grpc_port_mismatch',
      'proxy_unhealthy_direct_fallback',
    ].includes(reason);
  }

  private activeQrAttemptAgeMs(workerId: string): number | undefined {
    const active = this.qrConnectionRequestPayloads.get(workerId);
    if (!active) {
      return undefined;
    }

    return Math.max(0, Date.now() - active.startedAtMs);
  }

  private markQrContainerRecreateCooldown(
    workerId: string,
    reason: string
  ): void {
    this.qrContainerRecreateCooldowns.set(workerId, {
      reason,
      untilMs: Date.now() + getConnectionQrRecreateCooldownMs(),
    });
  }

  private shouldSuppressQrContainerRecreate(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    recreateReason: string,
    inspection: WorkerContainerInspection
  ): boolean {
    if (this.isHardQrContainerRecreateReason(recreateReason)) {
      return false;
    }

    if (!inspection.exists || inspection.running !== true) {
      return false;
    }

    const now = Date.now();
    const activeAgeMs = this.activeQrAttemptAgeMs(workerId);
    const firstQrTimeoutMs = getConnectionQrFirstQrTimeoutMs();
    const cooldown = this.qrContainerRecreateCooldowns.get(workerId);
    const cooldownActive = Boolean(cooldown && cooldown.untilMs > now);
    const firstQrWindowActive =
      activeAgeMs !== undefined && activeAgeMs <= firstQrTimeoutMs;

    if (!cooldownActive && !firstQrWindowActive) {
      return false;
    }

    const reason = cooldownActive
      ? 'recreate_cooldown_active'
      : 'first_qr_window_active';
    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.qrcode_container_recreate_suppressed',
      decision: 'suppress_qr_container_recreate',
      outcome: 'suppressed',
      reason,
      recreate_reason: recreateReason,
      level: 'warn',
      worker_type: workerData.workerTypeId,
      server_id: workerData.serverId,
      account_id: workerData.accountIdResolved,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId,
      qr_pending_age_ms: activeAgeMs,
      deadline_ms: firstQrTimeoutMs,
      recreate_cooldown_ms: getConnectionQrRecreateCooldownMs(),
      recreate_cooldown_reason: cooldown?.reason,
      ...this.lifecycleFieldsFromInspection(inspection),
    });
    recordConnectionAttemptTelemetry({
      event: 'balancer_qrcode_container_recreate_suppressed',
      stage:
        'connection.balancer.command_handler.qrcode_container_recreate_suppressed',
      metric_event: 'qr_outcome',
      level: 'warn',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      server_id: workerData.serverId,
      worker_type: workerData.workerTypeId,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      container_id: inspection.container_id,
      container_name: inspection.container_name,
      outcome: 'pending',
      reason,
      recreate_reason: recreateReason,
      qr_pending_age_ms: activeAgeMs,
      deadline_ms: firstQrTimeoutMs,
    });
    recordConnectionQrSummary({
      event: 'balancer_qrcode_container_recreate_suppressed',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type: workerData.workerTypeId,
      server_id: workerData.serverId,
      container_id: inspection.container_id,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      recreate_reason: recreateReason,
      reason,
      qr_pending: true,
      level: 'warn',
    });

    return true;
  }

  private isWorkerGrpcReadinessRequired(workerType: EWorkerType): boolean {
    return (
      workerType === EWorkerType.baileys ||
      workerType === EWorkerType.wwebjs ||
      workerType === EWorkerType.whatsmeow
    );
  }

  private getExpectedWorkerGrpcPort(
    workerType: EWorkerType
  ): number | undefined {
    if (workerType === EWorkerType.wwebjs) {
      return balanceEnvironment.workerWwebjsGrpcPort;
    }

    if (workerType === EWorkerType.whatsmeow) {
      return balanceEnvironment.workerWhatsmeowGrpcPort;
    }

    if (workerType === EWorkerType.baileys) {
      return balanceEnvironment.workerBaileysGrpcPort;
    }

    return undefined;
  }

  private async waitForWorkerGrpcReady(
    workerId: string,
    workerType: EWorkerType,
    timeoutMs?: number,
    stageScope: 'qrcode' | 'create' | 'recreate' = 'qrcode'
  ): Promise<string> {
    recordConnectionLifecycle({
      stage: `connection.balancer.command_handler.${stageScope}_grpc_readiness_start`,
      decision: 'wait_worker_grpc_ready',
      outcome: 'started',
      worker_type: workerType,
      deadline_ms: timeoutMs,
    });

    try {
      const grpcAddress =
        await this.workerBaileysGrpcClientService.waitForReady(
          workerId,
          workerType,
          timeoutMs
        );
      recordConnectionLifecycle({
        stage: `connection.balancer.command_handler.${stageScope}_grpc_readiness_success`,
        decision: 'wait_worker_grpc_ready',
        outcome: 'ready',
        worker_type: workerType,
        grpc_address: grpcAddress,
        grpc_probe_address: grpcAddress,
        grpc_ready: true,
        deadline_ms: timeoutMs,
      });
      return grpcAddress;
    } catch (err) {
      recordConnectionLifecycle({
        stage: `connection.balancer.command_handler.${stageScope}_grpc_readiness_error`,
        decision: 'wait_worker_grpc_ready',
        outcome: 'error',
        reason: 'worker_grpc_not_ready',
        level: 'error',
        worker_type: workerType,
        grpc_ready: false,
        deadline_ms: timeoutMs,
        error: getErrorMessage(err),
      });
      throw err;
    }
  }

  private async tryRequestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<boolean> {
    try {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.try_request_start',
        decision: 'request_worker_connection',
        outcome: 'started',
        worker_type: workerType,
        status: payload.status,
        connection_type: payload.type,
      });
      await this.workerBaileysGrpcClientService.requestConnection(
        workerId,
        payload,
        workerType
      );
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.try_request_success',
        decision: 'request_worker_connection',
        outcome: 'success',
        worker_type: workerType,
        status: payload.status,
        connection_type: payload.type,
      });
      return true;
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.try_request_error',
        decision: 'request_worker_connection',
        outcome: 'error',
        reason: 'request_failed',
        level: 'warn',
        worker_type: workerType,
        status: payload.status,
        connection_type: payload.type,
        error: getErrorMessage(err),
      });
      console.error('Initial worker connection request failed:', {
        workerId,
        workerType,
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  private async isExistingContainerHealthy(
    containerId: string,
    options: ContainerHealthCheckOptions
  ): Promise<boolean> {
    try {
      const result = await this.containerHealthService.checkServiceHealth(
        containerId,
        options
      );
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.container_health_result',
        decision: 'is_existing_container_healthy',
        outcome: result.healthy ? 'healthy' : 'unhealthy',
        container_id: containerId,
        health_url: result.health_url,
        health_status_code: result.health_status_code || 'none',
        health_attempt: result.health_attempt,
        health_max_attempts: result.health_max_attempts,
        health_delay_ms: result.health_delay_ms,
        consecutive_successes: result.consecutive_successes,
        required_consecutive_successes: result.required_consecutive_successes,
        health_duration_ms: result.health_duration_ms,
        health_error: result.health_error,
        health_failure_reason: result.health_failure_reason,
      });
      recordConnectionAttemptTelemetry({
        event: 'balancer_container_health_result',
        stage: 'connection.balancer.command_handler.container_health_result',
        metric_event: 'container_health',
        container_id: containerId,
        outcome: result.healthy ? 'healthy' : 'unhealthy',
        reason: result.health_failure_reason,
        health_status_code: result.health_status_code || 'none',
        health_failure_reason: result.health_failure_reason,
        duration_ms: result.health_duration_ms,
      });
      return result.healthy;
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.container_health_error',
        decision: 'is_existing_container_healthy',
        outcome: 'error',
        reason: 'health_check_failed',
        level: 'warn',
        error: getErrorMessage(err),
      });
      console.error('Failed to check worker container health:', {
        containerId,
        error: getErrorMessage(err),
      });
      return false;
    }
  }

  private async publishConnectionFailure(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    if (!accountId) {
      return;
    }

    await this.centrifugoPublish({
      status: EBaileysConnectionStatus.disconnected,
      code: ECodeMessage.connectionClosed,
      worker_id: payload.worker_id,
      account_id: accountId,
    });
  }

  private async resolveWorkerDataForContainer(
    workerId: string,
    accountId?: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const attachRuntime = async (
      data: ResolvedWorkerDataForContainer | null
    ): Promise<ResolvedWorkerDataForContainer | null> => {
      if (!data || !this.workerRuntimeRepository) {
        return data;
      }

      const runtime =
        await this.workerRuntimeRepository.viewByWorkerId(workerId);
      if (!runtime) {
        return data;
      }

      return {
        ...data,
        containerId: data.containerId ?? runtime.container_id,
        runtimeGeneration: runtime.runtime_generation,
        warmPoolId: runtime.warm_pool_id,
      };
    };

    if (accountId) {
      const fromView = await this.resolveWorkerDataFromView(
        accountId,
        workerId
      );
      if (fromView) {
        const fromMonitor = await this.resolveWorkerDataFromMonitor(workerId);
        return attachRuntime({
          ...fromView,
          containerId: fromMonitor?.containerId,
          lifecycleOperationId: fromMonitor?.lifecycleOperationId,
          runtimeGeneration: fromMonitor?.runtimeGeneration,
          warmPoolId: fromMonitor?.warmPoolId,
        });
      }
    }

    return attachRuntime(await this.resolveWorkerDataFromMonitor(workerId));
  }

  private async resolveWorkerDataFromView(
    accountId: string,
    workerId: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const view = await this.workerService.viewWorker(accountId, workerId);
    if (!view?.server?.id || !view?.type?.id) {
      return null;
    }

    return {
      accountIdResolved: accountId,
      serverId: view.server.id,
      serverName: view.server.name ?? undefined,
      workerTypeId: view.type.id as EWorkerType,
      workerTypeName: view.type.name ?? undefined,
      workerStatusId: view.status?.id as EWorkerStatus | undefined,
    };
  }

  private async resolveWorkerDataFromMonitor(
    workerId: string
  ): Promise<ResolvedWorkerDataForContainer | null> {
    const monitorView = await this.workerService.viewWorkerForMonitor(workerId);
    if (
      !monitorView?.account_id ||
      !monitorView?.server_id ||
      !monitorView?.worker_type_id
    ) {
      return null;
    }

    return {
      accountIdResolved: monitorView.account_id,
      serverId: monitorView.server_id,
      workerTypeId: monitorView.worker_type_id as EWorkerType,
      workerStatusId: monitorView.worker_status_id as EWorkerStatus,
      containerId: monitorView.container_id,
      lifecycleOperationId: monitorView.lifecycle_operation_id,
    };
  }

  private recordLegacyLifecycleOperation(
    workerId: string,
    operation: string
  ): void {
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.lifecycle_operation_legacy',
      decision: operation,
      outcome: 'legacy',
      reason: 'missing_lifecycle_operation_id',
      level: 'warn',
      worker_id: workerId,
    });
  }

  private async isLifecycleOperationCurrent(
    data: IWorkerPayload,
    operation: string,
    options: { allowServerMismatch?: boolean } = {}
  ): Promise<boolean> {
    if (!data.lifecycle_operation_id) {
      this.recordLegacyLifecycleOperation(data.worker_id, operation);
      return true;
    }

    const current = await this.workerService.viewWorkerForMonitor(
      data.worker_id
    );
    const currentOperationId = current?.lifecycle_operation_id ?? null;
    const operationMatches = currentOperationId === data.lifecycle_operation_id;
    const accountMatches = current?.account_id === data.account_id;
    const serverMatches =
      options.allowServerMismatch === true ||
      !data.server_id ||
      current?.server_id === data.server_id;

    const isCurrent = Boolean(
      current && operationMatches && accountMatches && serverMatches
    );

    if (!isCurrent) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.lifecycle_operation_stale',
        decision: operation,
        outcome: 'stale',
        reason: 'stale_lifecycle_operation',
        level: 'warn',
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        current_lifecycle_operation_id: currentOperationId,
        current_server_id: current?.server_id,
        current_worker_type_id: current?.worker_type_id,
      });
      return false;
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.lifecycle_operation_current',
      decision: operation,
      outcome: 'current',
      worker_id: data.worker_id,
      account_id: data.account_id,
      server_id: data.server_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      current_worker_type_id: current?.worker_type_id,
    });

    return true;
  }

  private async isWorkerSnapshotCurrent(
    workerId: string,
    accountId: string,
    serverId: string,
    workerTypeId: EWorkerType,
    operation: string
  ): Promise<boolean> {
    const current = await this.workerService.viewWorkerForMonitor(workerId);
    const isCurrent = Boolean(
      current &&
      current.account_id === accountId &&
      current.server_id === serverId &&
      current.worker_type_id === workerTypeId
    );

    if (!isCurrent) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.worker_snapshot_stale',
        decision: operation,
        outcome: 'stale',
        reason: 'worker_snapshot_changed',
        level: 'warn',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        worker_type: workerTypeId,
        current_server_id: current?.server_id,
        current_worker_type_id: current?.worker_type_id,
        current_lifecycle_operation_id: current?.lifecycle_operation_id,
      });
      return false;
    }

    return true;
  }

  private async updateWorkerWithLifecycleGuard(
    accountId: string,
    input: IUpdateWorker,
    data: IWorkerPayload,
    operation: string,
    workerTypeId?: EWorkerType
  ): Promise<boolean> {
    if (data.lifecycle_operation_id) {
      return this.workerService.updateWorkerByIdIfLifecycleMatches(
        accountId,
        input,
        {
          lifecycle_operation_id: data.lifecycle_operation_id,
          server_id: data.server_id,
          ...(workerTypeId ? { worker_type_id: workerTypeId } : {}),
        }
      );
    }

    const current = await this.isWorkerSnapshotCurrent(
      data.worker_id,
      accountId,
      data.server_id,
      workerTypeId ?? data.worker_type_id ?? ('' as EWorkerType),
      operation
    );

    if (!current) {
      return false;
    }

    return this.workerService.updateWorkerById(accountId, input);
  }

  private async updateWorkerWithLifecycleGuardAndLegacyRetry(
    accountId: string,
    input: IUpdateWorker,
    data: IWorkerPayload,
    operation: string,
    workerTypeId?: EWorkerType
  ): Promise<boolean> {
    if (data.lifecycle_operation_id) {
      return this.updateWorkerWithLifecycleGuard(
        accountId,
        input,
        data,
        operation,
        workerTypeId
      );
    }

    return this.retryOperation(
      async () =>
        this.updateWorkerWithLifecycleGuard(
          accountId,
          input,
          data,
          operation,
          workerTypeId
        ),
      (r) => !r
    );
  }

  private async waitForConnectionQrCodeConsumerReady(
    workerId: string,
    accountId: string,
    workerType: EWorkerType | undefined,
    operation: string
  ): Promise<void> {
    if (
      workerType !== EWorkerType.baileys &&
      workerType !== EWorkerType.wwebjs &&
      workerType !== EWorkerType.whatsmeow
    ) {
      return;
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.qrcode_consumer.readiness_wait_start',
      decision: 'wait_connection_qrcode_consumer_ready',
      outcome: 'started',
      worker_id: workerId,
      account_id: accountId,
      worker_type: workerType,
      worker_type_id: workerType,
      operation,
    });

    const ready =
      await this.workerConnectionQrCodeReadinessService.waitUntilReady(
        {
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: workerType,
        },
        45_000,
        500
      );

    recordConnectionLifecycle({
      stage: 'connection.balancer.qrcode_consumer.readiness_wait_result',
      decision: 'wait_connection_qrcode_consumer_ready',
      outcome: ready ? 'ready' : 'timeout',
      level: ready ? 'info' : 'error',
      reason: ready ? undefined : 'qrcode_consumer_not_ready',
      worker_id: workerId,
      account_id: accountId,
      worker_type: workerType,
      worker_type_id: workerType,
      operation,
    });

    if (!ready) {
      throw new Error('Worker connection QR consumer is not ready');
    }
  }

  private async createWorkerWithPayload(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    connectionRequest?: StatusConnectionWorkerRequest,
    options: CreateWorkerOptions = {}
  ): Promise<void> {
    const createPayload: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      server_id: workerData.serverId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      ...(workerData.lifecycleOperationId
        ? { lifecycle_operation_id: workerData.lifecycleOperationId }
        : {}),
    };

    await this.createWorker(createPayload, connectionRequest, options);
  }

  private startConnectionRequestRetry(
    payload: StatusConnectionWorkerRequest
  ): void {
    if (payload.type === EBaileysConnectionType.qrcode) {
      console.warn('Skipping background QR Code connection request:', {
        workerId: payload.worker_id,
        status: payload.status,
      });
      return;
    }

    this.stopConnectionRequestRetry(payload.worker_id);
    this.connectionRequestPayloads.set(payload.worker_id, payload);
    this.connectionRequestAttempts.set(payload.worker_id, 0);
    void this.runConnectionRequestAttempt(payload.worker_id);
  }

  private stopConnectionRequestRetry(workerId: string): void {
    const timer = this.connectionRequestTimers.get(workerId);
    if (timer) {
      clearTimeout(timer);
      this.connectionRequestTimers.delete(workerId);
    }
    this.connectionRequestPayloads.delete(workerId);
    this.connectionRequestAttempts.delete(workerId);
  }

  private scheduleNextConnectionRequest(workerId: string): void {
    const timer = setTimeout(() => {
      void this.runConnectionRequestAttempt(workerId);
    }, this.connectionRequestRetryIntervalMs);
    this.connectionRequestTimers.set(workerId, timer);
  }

  private async runConnectionRequestAttempt(workerId: string): Promise<void> {
    const payload = this.connectionRequestPayloads.get(workerId);
    if (!payload) {
      return;
    }

    const attempt = (this.connectionRequestAttempts.get(workerId) ?? 0) + 1;
    this.connectionRequestAttempts.set(workerId, attempt);

    try {
      const workerType = await this.resolveWorkerTypeForConnection(workerId);
      await this.workerBaileysGrpcClientService.requestConnection(
        workerId,
        payload,
        workerType
      );
      this.stopConnectionRequestRetry(workerId);
    } catch (err) {
      console.error('Failed to request worker connection:', err);

      if (attempt < this.connectionRequestMinAttempts) {
        this.scheduleNextConnectionRequest(workerId);
        return;
      }

      this.scheduleNextConnectionRequest(workerId);
    }
  }

  private async resolveWorkerTypeForConnection(
    workerId: string,
    accountId?: string
  ): Promise<EWorkerType | undefined> {
    if (accountId) {
      const viewWorkerType = await this.workerService.viewWorkerType(
        accountId,
        workerId
      );

      if (viewWorkerType?.worker_type_id) {
        return viewWorkerType.worker_type_id as EWorkerType;
      }
    }

    const monitorView = await this.workerService.viewWorkerForMonitor(workerId);
    if (monitorView?.worker_type_id) {
      return monitorView.worker_type_id as EWorkerType;
    }

    return undefined;
  }

  private async resolveWorkerProxyConfig(
    workerId: string,
    serverId: string
  ): Promise<ResolvedWorkerProxyConfig | undefined> {
    try {
      const channelProxy = await this.resolveChannelProxyConfig(workerId);
      if (channelProxy) {
        return channelProxy;
      }
    } catch (err) {
      console.error(
        'Failed to resolve channel proxy config. Falling back to server proxy.',
        {
          workerId,
          serverId,
          error: getErrorMessage(err),
        }
      );
    }

    try {
      return await this.resolveServerProxyConfig(serverId);
    } catch (err) {
      console.error('Failed to resolve server proxy config', {
        serverId,
        error: getErrorMessage(err),
      });

      return undefined;
    }
  }

  private async resolveQrProxyDecision(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<QrProxyDecision> {
    const proxy = await this.resolveWorkerProxyConfig(
      workerId,
      workerData.serverId
    );

    if (!proxy) {
      return {
        proxy: undefined,
        fallbackDirect: false,
        status: 'disabled',
      };
    }

    let result: ProxyConnectivityResult;
    try {
      result = await this.proxyConnectivityService.check(proxy);
    } catch (err) {
      result = {
        status: 'unhealthy',
        error_code: getErrorMessage(err),
      };
    }

    recordConnectionQrSummary({
      event:
        result.status === 'healthy'
          ? 'balancer_qrcode_proxy_healthy'
          : 'balancer_qrcode_proxy_unhealthy',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type: workerData.workerTypeId,
      proxy_status: result.status,
      proxy_error_code: result.error_code,
      reason:
        result.status === 'healthy'
          ? 'proxy_connectivity_ok'
          : 'proxy_connectivity_failed',
      level: result.status === 'healthy' ? 'info' : 'warn',
    });

    if (result.status === 'healthy') {
      return {
        proxy,
        fallbackDirect: false,
        status: 'healthy',
      };
    }

    recordConnectionQrSummary({
      event: 'balancer_qrcode_proxy_fallback_direct',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type: workerData.workerTypeId,
      proxy_status: 'unhealthy',
      proxy_error_code: result.error_code,
      proxy_fallback: 'direct',
      proxy_bypassed: true,
      reason: 'proxy_unhealthy',
      level: 'warn',
    });

    return {
      proxy: undefined,
      fallbackDirect: true,
      status: 'unhealthy',
      errorCode: result.error_code,
    };
  }

  private containerHasProxy(inspection: WorkerContainerInspection): boolean {
    return Boolean(
      inspection.container_env?.PROXY_HOST ||
      inspection.container_env?.PROXY_PORT ||
      inspection.container_labels?.['underchat.proxy_mode'] === 'proxy'
    );
  }

  private async resolveChannelProxyConfig(workerId: string): Promise<
    | {
        protocol: EProxyProtocol;
        host: string;
        port: number;
        username?: string | null;
        password?: string | null;
      }
    | undefined
  > {
    const [
      proxyEnabled,
      proxyProtocol,
      proxyHost,
      proxyPort,
      proxyUsername,
      proxyPassword,
    ] = await Promise.all([
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_enabled
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_protocol
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_host
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_port
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_username
      ),
      this.workerConfigViewerRepository.fetchConfigValueByType(
        workerId,
        EWorkerConfigType.proxy_password
      ),
    ]);

    if (proxyEnabled.statusId !== EWorkerConfigStatus.active) {
      return undefined;
    }

    const host = proxyHost.value?.trim();
    const port = Number.parseInt(proxyPort.value ?? '', 10);
    if (!host || !Number.isFinite(port) || port <= 0) {
      return undefined;
    }

    return {
      protocol: this.normalizeProxyProtocol(proxyProtocol.value),
      host,
      port,
      username: this.tryDecryptProxyValue(proxyUsername.value),
      password: this.tryDecryptProxyValue(proxyPassword.value),
    };
  }

  private async resolveServerProxyConfig(serverId: string): Promise<
    | {
        protocol: EProxyProtocol;
        host: string;
        port: number;
        username?: string | null;
        password?: string | null;
      }
    | undefined
  > {
    const server =
      await this.serverSshViewerRepository.viewServerSshById(serverId);
    if (!server) {
      return undefined;
    }

    if (
      !server.proxy_enabled ||
      !server.proxy_host ||
      !server.proxy_port ||
      !Number.isFinite(server.proxy_port)
    ) {
      return undefined;
    }

    return {
      protocol: this.normalizeProxyProtocol(server.proxy_protocol),
      host: server.proxy_host,
      port: server.proxy_port,
      username: this.tryDecryptProxyValue(server.proxy_username),
      password: this.tryDecryptProxyValue(server.proxy_password),
    };
  }

  private tryDecryptProxyValue(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      return this.passwordEncryptorService.decrypt(value);
    } catch {
      return value;
    }
  }

  private async centrifugoPublish(
    dataPublish: IBaileysConnectionState
  ): Promise<PublishResult> {
    const channel = workerCentrifugoQueue(dataPublish.account_id);
    const stale = await this.shouldIgnoreQrAttemptState(dataPublish);
    if (stale.ignored) {
      recordConnectionQrSummary({
        event: 'balancer_centrifugo_publish_ignored_stale',
        ...summarizeConnectionQrState(dataPublish),
        reason: stale.reason,
        publish_source: 'centrifugo_publish',
        ignored_stale: true,
        level: 'warn',
      });
      return {} as PublishResult;
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.centrifugo.publish_start',
      decision: 'publish_connection_state',
      outcome: 'started',
      centrifugo_channel: channel,
      status: dataPublish.status,
      code: dataPublish.code,
      worker_status_id: dataPublish.worker_status_id,
      connection_attempt_id: dataPublish.connection_attempt_id,
      qrcode: dataPublish.qrcode,
      pairing_code: dataPublish.pairing_code,
      has_qr: Boolean(dataPublish.qrcode),
      has_pairing_code: Boolean(dataPublish.pairing_code),
    });

    try {
      const result = await this.centrifugoService.publishSub(
        channel,
        dataPublish
      );
      recordConnectionLifecycle({
        stage: 'connection.balancer.centrifugo.publish_success',
        decision: 'publish_connection_state',
        outcome: 'success',
        centrifugo_channel: channel,
        publish_result: 'success',
        status: dataPublish.status,
        code: dataPublish.code,
        worker_status_id: dataPublish.worker_status_id,
        connection_attempt_id: dataPublish.connection_attempt_id,
        qrcode: dataPublish.qrcode,
        pairing_code: dataPublish.pairing_code,
        has_qr: Boolean(dataPublish.qrcode),
        has_pairing_code: Boolean(dataPublish.pairing_code),
        value: result,
      });
      return result;
    } catch (err) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.centrifugo.publish_error',
        decision: 'publish_connection_state',
        outcome: 'error',
        reason: 'centrifugo_publish_failed',
        level: 'error',
        centrifugo_channel: channel,
        publish_result: 'error',
        status: dataPublish.status,
        code: dataPublish.code,
        worker_status_id: dataPublish.worker_status_id,
        connection_attempt_id: dataPublish.connection_attempt_id,
        error: getErrorMessage(err),
      });
      throw err;
    }
  }

  private async updateWorkerErrorStatus(
    workerId: string,
    accountId: string,
    action?: EWorkerAction,
    serverId?: string,
    lifecycleOperationId?: string
  ): Promise<PublishResult> {
    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.error,
      ...(lifecycleOperationId ? { lifecycle_operation_id: null } : {}),
    };

    const updated = lifecycleOperationId
      ? await this.workerService.updateWorkerByIdIfLifecycleMatches(
          accountId,
          inputUpdate,
          {
            lifecycle_operation_id: lifecycleOperationId,
            ...(serverId ? { server_id: serverId } : {}),
          }
        )
      : await this.workerService.updateWorkerById(accountId, inputUpdate);

    if (!updated && lifecycleOperationId) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.error_status_update_skipped',
        decision: 'update_worker_error_status',
        outcome: 'skipped',
        reason: 'stale_lifecycle_operation',
        level: 'warn',
        worker_id: workerId,
        account_id: accountId,
        server_id: serverId,
        lifecycle_operation_id: lifecycleOperationId,
      });
      return {} as PublishResult;
    }

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.error,
    };

    const publishPromises: Promise<PublishResult>[] = [
      this.centrifugoPublish(dataPublish),
    ];

    if (
      (action === EWorkerAction.delete || action === EWorkerAction.recreate) &&
      serverId
    ) {
      const errorPayload: IWorkerPayload = {
        action: action,
        worker_id: workerId,
        server_id: serverId,
        account_id: accountId,
        worker_status_id: EWorkerStatus.error,
      };

      publishPromises.push(
        this.centrifugoService.publish(channelsConfigCentrifugo(), errorPayload)
      );
    }

    const [result] = await Promise.all(publishPromises);
    return result;
  }

  private optionalNonEmpty(
    value: string | undefined | null
  ): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
  }

  private getSessionVolumeNameFromInspection(
    inspection: WorkerContainerInspection | undefined
  ): {
    sessionVolumeName?: string;
    source?: 'container_label' | 'container_env';
  } {
    const labelVolume = this.optionalNonEmpty(
      inspection?.container_labels?.['underchat.session_volume_name']
    );
    if (labelVolume) {
      return { sessionVolumeName: labelVolume, source: 'container_label' };
    }

    const envVolume = this.optionalNonEmpty(
      inspection?.container_env?.SESSION_VOLUME_NAME
    );
    if (envVolume) {
      return { sessionVolumeName: envVolume, source: 'container_env' };
    }

    return {};
  }

  private async resolveRecreateSessionVolume(
    data: IWorkerPayload,
    shouldRemoveVolume: boolean
  ): Promise<RecreateSessionVolumeResolution> {
    if (shouldRemoveVolume) {
      return {
        source: 'reset',
        runtimeWasBackfilled: false,
      };
    }

    const runtimeBeforeRemove =
      (await this.workerRuntimeRepository?.viewByWorkerId(data.worker_id)) ??
      null;
    const runtimeVolume = this.optionalNonEmpty(
      runtimeBeforeRemove?.session_volume_name
    );

    if (runtimeVolume) {
      return {
        sessionVolumeName: runtimeVolume,
        source: 'worker_runtime',
        runtimeWasBackfilled: false,
      };
    }

    const inspection = await this.workerService.inspectContainerWorkerById(
      data.worker_id
    );
    const containerVolume = this.getSessionVolumeNameFromInspection(inspection);
    const sessionVolumeName =
      containerVolume.sessionVolumeName ?? data.worker_id;
    const source = containerVolume.source ?? 'legacy_worker_id';

    if (inspection.exists && this.workerRuntimeRepository) {
      const volumeExists =
        await this.workerService.existsVolumeByName(sessionVolumeName);

      if (volumeExists) {
        await this.workerRuntimeRepository.upsert({
          worker_id: data.worker_id,
          container_id: inspection.container_id,
          container_name: inspection.container_name ?? data.worker_id,
          session_volume_name: sessionVolumeName,
          activated_at: currentTime(),
        });
        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.runtime_legacy_backfilled',
          decision: 'resolve_recreate_session_volume',
          outcome: 'success',
          worker_id: data.worker_id,
          account_id: data.account_id,
          container_id: inspection.container_id,
          container_name: inspection.container_name,
          session_volume_name: sessionVolumeName,
          session_volume_source: source,
        });
      }
    }

    return {
      sessionVolumeName,
      source,
      runtimeWasBackfilled: inspection.exists,
    };
  }

  private async assertPreservedSessionVolumeExists(
    data: IWorkerPayload,
    resolution: RecreateSessionVolumeResolution,
    workerType: EWorkerType
  ): Promise<void> {
    if (!resolution.sessionVolumeName) {
      return;
    }

    const existsVolume = await this.workerService.existsVolumeByName(
      resolution.sessionVolumeName
    );

    if (existsVolume) {
      return;
    }

    recordConnectionLifecycle({
      stage:
        'connection.balancer.command_handler.recreate_session_volume_missing',
      decision: 'preserve_session_volume',
      outcome: 'error',
      reason: 'session_volume_missing',
      level: 'error',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type: workerType,
      worker_type_id: workerType,
      session_volume_name: resolution.sessionVolumeName,
      session_volume_source: resolution.source,
      runtime_was_backfilled: resolution.runtimeWasBackfilled,
    });

    await this.updateWorkerErrorStatus(
      data.worker_id,
      data.account_id,
      data.action,
      data.server_id,
      data.lifecycle_operation_id
    );

    throw new Error(
      `Worker session volume ${resolution.sessionVolumeName} not found. Recreate aborted to preserve WhatsApp session.`
    );
  }

  private async recreateWorker(data: IWorkerPayload): Promise<PublishResult> {
    if (!(await this.isLifecycleOperationCurrent(data, 'recreate_worker'))) {
      return {} as PublishResult;
    }

    const viewWorkerType = await this.workerService.viewWorkerType(
      data.account_id,
      data.worker_id
    );

    if (!viewWorkerType) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker not found');
    }

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
    const shouldRemoveSession = data.remove_session === true;
    const shouldRemoveVolume = data.remove_volume === true;
    const sessionVolumeResolution = await this.resolveRecreateSessionVolume(
      data,
      shouldRemoveVolume
    );
    const preservedSessionVolumeName =
      sessionVolumeResolution.sessionVolumeName;

    if (
      !(await this.isLifecycleOperationCurrent(
        data,
        'recreate_worker_before_remove'
      ))
    ) {
      return {} as PublishResult;
    }

    await this.invalidateQrAttemptState(data.worker_id, {
      accountId: data.account_id,
      workerType,
      reason: 'worker_recreate',
      recreateReason: shouldRemoveVolume
        ? 'recreate_with_volume_reset'
        : 'recreate_container_replaced',
    });

    if (shouldRemoveSession && shouldRemoveVolume) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.recreate_disconnect_skipped',
        decision: 'request_disconnect_before_recreate',
        outcome: 'skipped',
        reason: 'session_volume_will_be_removed',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type: workerType,
        worker_type_id: workerType,
        remove_session: true,
        remove_volume: true,
      });
    } else if (shouldRemoveSession) {
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
      };

      try {
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          disconnectPayload,
          workerType
        );
      } catch (err) {
        if (!this.isTopicOrPartitionMissing(err)) {
          console.error('Failed to request worker disconnect before recreate', {
            workerId: data.worker_id,
            accountId: data.account_id,
            error: getErrorMessage(err),
          });
        }
      }
    }

    if (!shouldRemoveVolume) {
      await this.assertPreservedSessionVolumeExists(
        data,
        sessionVolumeResolution,
        workerType
      );
    }

    const removed = await this.retryOperation(
      async () =>
        this.removeRuntimeContainer(data.worker_id, shouldRemoveVolume),
      (r) => !r
    );

    if (!removed) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker removal failed');
    }

    const imageName = getImageWorker(workerType);

    try {
      await this.kafkaBaileysQueueService.ensure(data.worker_id);
    } catch (err) {
      console.error('Failed to pre-create Kafka topics for worker:', {
        workerId: data.worker_id,
        error: getErrorMessage(err),
      });
    }

    const proxy = await this.resolveWorkerProxyConfig(
      data.worker_id,
      data.server_id
    );

    if (
      !(await this.isLifecycleOperationCurrent(
        data,
        'recreate_worker_before_create'
      ))
    ) {
      return {} as PublishResult;
    }

    const containerId = await this.retryOperation(
      async () => {
        const options = {
          workerTypeId: workerType,
          workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
        };

        if (preservedSessionVolumeName) {
          return this.workerService.createContainerWorker(
            imageName,
            data.worker_id,
            data.account_id,
            false,
            balanceEnvironment.grpcHost,
            balanceEnvironment.grpcPort,
            proxy,
            options,
            preservedSessionVolumeName,
            { requireExistingVolume: true }
          );
        }

        return this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          false,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy,
          options
        );
      },
      (r) => !r
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker creation failed');
    }

    const healthy = await this.containerHealthService.isServiceHealthy(
      containerId,
      this.buildNewContainerHealthOptions()
    );

    if (!healthy) {
      await this.recordContainerDiagnosticsSafely(
        data.worker_id,
        'recreate_health_failed'
      );
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker service is not healthy');
    }

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        await this.waitForWorkerGrpcReady(
          data.worker_id,
          workerType,
          undefined,
          'recreate'
        );
      } catch (err) {
        await this.recordContainerDiagnosticsSafely(
          data.worker_id,
          'recreate_grpc_readiness_failed'
        );
        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id,
          data.lifecycle_operation_id
        );
        throw err;
      }
    }

    const reconciliation = await this.reconcileRecreatedWorkerConnection(
      data,
      workerType
    );

    try {
      await this.waitForConnectionQrCodeConsumerReady(
        data.worker_id,
        data.account_id,
        workerType,
        'recreate_worker'
      );
    } catch (error) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw error;
    }

    const inputUpdate = this.buildRecreateFinalWorkerUpdate(
      data,
      workerType,
      containerId,
      shouldRemoveSession,
      reconciliation
    );

    const updated = await this.updateWorkerWithLifecycleGuardAndLegacyRetry(
      data.account_id,
      inputUpdate,
      data,
      'recreate_worker',
      workerType
    );

    if (!updated) {
      console.error('Failed to update worker status after recreate', {
        workerId: data.worker_id,
        accountId: data.account_id,
        action: data.action,
      });
      return {} as PublishResult;
    }

    await this.workerRuntimeRepository?.upsert({
      worker_id: data.worker_id,
      container_id: containerId,
      container_name: data.worker_id,
      session_volume_name: preservedSessionVolumeName ?? data.worker_id,
      activated_at: currentTime(),
    });

    return this.publishWorkerRecreateFinalState(data, reconciliation);
  }

  private async publishWorkerDisponible(
    data: IWorkerPayload
  ): Promise<PublishResult> {
    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    const channelConfigPayload: IWorkerPayload = {
      ...data,
      worker_status_id: EWorkerStatus.disponible,
    };

    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(
        channelsConfigCentrifugo(),
        channelConfigPayload
      ),
    ]);
    return result;
  }

  private shouldReconcileRecreatedWorkerConnection(
    data: IWorkerPayload
  ): boolean {
    return (
      data.remove_session !== true &&
      data.previous_worker_status_id === EWorkerStatus.online
    );
  }

  private isConnectedConnectionState(
    state: IBaileysConnectionState | undefined
  ): boolean {
    return (
      state?.worker_status_id === EWorkerStatus.online ||
      state?.status === EBaileysConnectionStatus.connected ||
      state?.code === ECodeMessage.connectionEstablished
    );
  }

  private async reconcileRecreatedWorkerConnection(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): Promise<RecreateConnectionReconciliation> {
    if (!this.shouldReconcileRecreatedWorkerConnection(data)) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.recreate_connection_reconcile_skipped',
        decision: 'reconcile_recreated_worker_connection',
        outcome: 'skipped',
        reason:
          data.remove_session === true
            ? 'session_removed'
            : 'previous_status_not_online',
        worker_id: data.worker_id,
        account_id: data.account_id,
        previous_worker_status_id: data.previous_worker_status_id,
      });

      return { workerStatusId: EWorkerStatus.disponible };
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
    };

    try {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.recreate_connection_reconcile_start',
        decision: 'reconcile_recreated_worker_connection',
        outcome: 'started',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type: workerType,
      });

      const response =
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          payload,
          workerType
        );
      const current = await this.workerService.viewWorkerForMonitor(
        data.worker_id
      );
      const connected =
        this.isConnectedConnectionState(response) ||
        current?.worker_status_id === EWorkerStatus.online;

      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.recreate_connection_reconcile_success',
        decision: 'reconcile_recreated_worker_connection',
        outcome: connected ? 'connected' : 'not_connected',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type: workerType,
        status: response?.status,
        code: response?.code,
        worker_status_id: response?.worker_status_id,
        current_worker_status_id: current?.worker_status_id,
        has_phone: Boolean(response?.phone),
        has_qr: Boolean(response?.qrcode),
        has_pairing_code: Boolean(response?.pairing_code),
      });

      if (!connected) {
        return { workerStatusId: EWorkerStatus.disponible };
      }

      return {
        workerStatusId: EWorkerStatus.online,
        connectionState: {
          code: response?.code ?? ECodeMessage.connectionEstablished,
          status:
            response?.status === EBaileysConnectionStatus.connected
              ? response.status
              : EBaileysConnectionStatus.connected,
          worker_id: data.worker_id,
          account_id: data.account_id,
          phone: response?.phone,
          worker_status_id: EWorkerStatus.online,
        },
      };
    } catch (err) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.recreate_connection_reconcile_error',
        decision: 'reconcile_recreated_worker_connection',
        outcome: 'error',
        reason: 'request_connection_failed',
        level: 'warn',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type: workerType,
        error: getErrorMessage(err),
      });

      return { workerStatusId: EWorkerStatus.disponible };
    }
  }

  private buildRecreateFinalWorkerUpdate(
    data: IWorkerPayload,
    workerType: EWorkerType,
    containerId: string,
    shouldRemoveSession: boolean,
    reconciliation: RecreateConnectionReconciliation
  ): IUpdateWorker {
    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: reconciliation.workerStatusId,
      worker_type_id: workerType,
      container_id: containerId,
      ...(data.lifecycle_operation_id ? { lifecycle_operation_id: null } : {}),
    };

    if (shouldRemoveSession) {
      inputUpdate.number = null;
      inputUpdate.connection_date = null;
      return inputUpdate;
    }

    if (
      reconciliation.workerStatusId === EWorkerStatus.online &&
      reconciliation.connectionState?.phone
    ) {
      inputUpdate.number = reconciliation.connectionState.phone;
      inputUpdate.connection_date = currentTime();
    }

    return inputUpdate;
  }

  private async publishWorkerRecreateFinalState(
    data: IWorkerPayload,
    reconciliation: RecreateConnectionReconciliation
  ): Promise<PublishResult> {
    if (reconciliation.workerStatusId !== EWorkerStatus.online) {
      return this.publishWorkerDisponible(data);
    }

    const state: IBaileysConnectionState = {
      code:
        reconciliation.connectionState?.code ??
        ECodeMessage.connectionEstablished,
      status: EBaileysConnectionStatus.connected,
      worker_id: data.worker_id,
      account_id: data.account_id,
      phone: reconciliation.connectionState?.phone,
      worker_status_id: EWorkerStatus.online,
    };

    const [result] = await Promise.all([
      this.centrifugoPublish(state),
      this.centrifugoService.publish(channelsConfigCentrifugo(), state),
    ]);
    return result;
  }

  private async removeRuntimeContainer(
    workerId: string,
    removeVolume: boolean,
    options: { cleanup?: boolean } = {}
  ): Promise<boolean> {
    if (!this.workerRuntimeRepository) {
      return options.cleanup
        ? this.workerService.cleanupContainerWorker(workerId, removeVolume)
        : this.workerService.removeContainerWorker(workerId, removeVolume);
    }

    const runtime = await this.workerRuntimeRepository.viewByWorkerId(workerId);
    const volumeName = runtime?.session_volume_name ?? workerId;
    const containerName = runtime?.container_name || workerId;
    const removed = await this.workerService.removeContainerByNameAndVolume(
      containerName,
      volumeName,
      removeVolume
    );

    if (removed && removeVolume) {
      await this.workerRuntimeRepository.deleteByWorkerId(workerId);
    }

    return removed;
  }

  private async cleanupWorker(data: IWorkerPayload): Promise<void> {
    this.stopConnectionRequestRetry(data.worker_id);

    if (
      !(await this.isLifecycleOperationCurrent(data, 'cleanup_worker', {
        allowServerMismatch: true,
      }))
    ) {
      return;
    }

    const cleanupRemovesVolume = data.remove_volume !== false;
    if (data.remove_session === true && cleanupRemovesVolume) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.command_handler.cleanup_disconnect_skipped',
        decision: 'request_disconnect_before_cleanup',
        outcome: 'skipped',
        reason: 'session_volume_will_be_removed',
        worker_id: data.worker_id,
        account_id: data.account_id,
        remove_session: true,
        remove_volume: cleanupRemovesVolume,
      });
    } else if (data.remove_session === true) {
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
      };

      try {
        const workerType = await this.resolveWorkerTypeForConnection(
          data.worker_id,
          data.account_id
        );
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          disconnectPayload,
          workerType
        );
      } catch (err) {
        if (!this.isTopicOrPartitionMissing(err)) {
          console.error('Failed to request worker disconnect before cleanup', {
            workerId: data.worker_id,
            accountId: data.account_id,
            error: getErrorMessage(err),
          });
        }
      }
    }

    const cleaned = await this.retryOperation(
      async () =>
        this.removeRuntimeContainer(data.worker_id, cleanupRemovesVolume, {
          cleanup: true,
        }),
      (r) => !r
    );

    if (!cleaned) {
      throw new Error('Worker cleanup failed');
    }
  }

  private async deleteWorker(data: IWorkerPayload): Promise<PublishResult> {
    const exists = await this.workerService.existsWorkerById(
      data.account_id,
      data.worker_id
    );

    const alreadyDeleted = !exists;
    if (alreadyDeleted) {
      console.warn('Worker not found during delete. Continuing cleanup.', {
        workerId: data.worker_id,
        accountId: data.account_id,
      });
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      number: null,
      container_id: null,
      connection_date: null,
    };

    if (!alreadyDeleted) {
      const updated = await this.retryOperation(
        async () =>
          this.workerService.updateWorkerById(data.account_id, inputUpdate),
        (r) => !r
      );

      if (!updated) {
        console.error('Failed to update worker status before delete', {
          workerId: data.worker_id,
          accountId: data.account_id,
          action: data.action,
        });
      }
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.delete_disconnect_skipped',
      decision: 'request_disconnect_before_delete',
      outcome: 'skipped',
      reason: 'session_volume_will_be_removed',
      worker_id: data.worker_id,
      account_id: data.account_id,
      remove_session: true,
      remove_volume: true,
    });

    let containerRemoved = false;
    try {
      containerRemoved = await this.retryOperation(
        async () => this.removeRuntimeContainer(data.worker_id, true),
        (r) => !r
      );
    } catch (err) {
      if (!alreadyDeleted) {
        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id
        );
        throw err;
      }
      console.error('Failed to remove container for deleted worker', {
        workerId: data.worker_id,
        accountId: data.account_id,
        error: getErrorMessage(err),
      });
    }

    if (!containerRemoved && !alreadyDeleted) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker removal failed');
    }

    if (!alreadyDeleted) {
      const deleted = await this.retryOperation(
        async () =>
          this.workerService.deleteWorkerById(data.account_id, data.worker_id),
        (r) => !r
      );

      if (!deleted) {
        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id
        );
        throw new Error('Failed to delete worker');
      }
    }

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.delete,
    };

    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(channelsConfigCentrifugo(), data),
    ]);
    return result;
  }

  private async createWorker(
    data: IWorkerPayload,
    connectionRequest?: StatusConnectionWorkerRequest,
    options: CreateWorkerOptions = {}
  ): Promise<PublishResult> {
    if (!data?.worker_type_id) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker type ID is required');
    }

    const workerType = data.worker_type_id;
    if (!(await this.isLifecycleOperationCurrent(data, 'create_worker'))) {
      return {} as PublishResult;
    }
    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType,
        'create_worker'
      ))
    ) {
      throw new Error('Worker lifecycle changed before create');
    }

    const createMaxAttempts = 2;
    const resolvedHealthOptions = this.buildNewContainerHealthOptions(
      options.healthOptions
    );

    const inputUpdateCreating: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.creating,
    };

    const creatingUpdated = await this.updateWorkerWithLifecycleGuard(
      data.account_id,
      inputUpdateCreating,
      data,
      'create_worker_mark_creating',
      workerType
    );

    if (!creatingUpdated) {
      return {} as PublishResult;
    }

    const dataPublishCreating: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.creating,
    };

    void this.centrifugoPublish(dataPublishCreating).catch((err) => {
      console.error('Failed to publish worker creating status:', err);
    });

    const imageName = getImageWorker(workerType);

    try {
      await this.kafkaBaileysQueueService.ensure(data.worker_id);
    } catch (err) {
      console.error('Failed to pre-create Kafka topics for worker:', {
        workerId: data.worker_id,
        error: getErrorMessage(err),
      });
    }

    const proxy =
      options.proxyOverride === undefined
        ? await this.resolveWorkerProxyConfig(data.worker_id, data.server_id)
        : (options.proxyOverride ?? undefined);

    let containerId: string | undefined;
    let lastError: unknown;

    for (
      let createAttempt = 1;
      createAttempt <= createMaxAttempts;
      createAttempt++
    ) {
      try {
        containerId = await this.runCreateWorkerProvisionAttempt(
          data,
          workerType,
          imageName,
          proxy,
          options.proxyMode,
          resolvedHealthOptions,
          createAttempt,
          createMaxAttempts
        );
        break;
      } catch (err) {
        lastError = err;
        const reason =
          err instanceof WorkerCreateAttemptError
            ? err.reason
            : 'create_attempt_failed';

        if (this.isStaleCreateAttemptReason(reason)) {
          recordConnectionLifecycle({
            stage:
              'connection.balancer.command_handler.create_attempt_stale_noop',
            decision: 'create_worker',
            outcome: 'skipped',
            reason,
            level: 'warn',
            worker_type: workerType,
            create_attempt: createAttempt,
            create_max_attempts: createMaxAttempts,
            error: getErrorMessage(err),
          });
          return {} as PublishResult;
        }

        if (createAttempt < createMaxAttempts) {
          await this.prepareCreateWorkerRetry(
            data,
            reason,
            createAttempt,
            createMaxAttempts
          );
          continue;
        }

        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.create_attempts_exhausted',
          decision: 'create_worker',
          outcome: 'error',
          reason,
          recreate_reason: reason,
          level: 'error',
          worker_type: workerType,
          create_attempt: createAttempt,
          create_max_attempts: createMaxAttempts,
          error: getErrorMessage(err),
          ...(err instanceof WorkerCreateAttemptError
            ? {
                container_id: err.containerId,
                health_status_code: err.healthResult?.health_status_code,
                health_error: err.healthResult?.health_error,
                consecutive_successes: err.healthResult?.consecutive_successes,
                required_consecutive_successes:
                  err.healthResult?.required_consecutive_successes,
                health_failure_reason: err.healthResult?.health_failure_reason,
              }
            : {}),
        });

        await this.updateWorkerErrorStatus(
          data.worker_id,
          data.account_id,
          data.action,
          data.server_id,
          data.lifecycle_operation_id
        );
        throw err;
      }
    }

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to create worker container');
    }

    try {
      await this.waitForConnectionQrCodeConsumerReady(
        data.worker_id,
        data.account_id,
        workerType,
        'create_worker'
      );
    } catch (error) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw error;
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
      ...(data.lifecycle_operation_id ? { lifecycle_operation_id: null } : {}),
    };

    const updated = await this.updateWorkerWithLifecycleGuardAndLegacyRetry(
      data.account_id,
      inputUpdate,
      data,
      'create_worker',
      workerType
    );

    if (!updated) {
      console.error('Failed to update worker status after create', {
        workerId: data.worker_id,
        accountId: data.account_id,
        containerId,
      });
    }

    await this.workerRuntimeRepository?.upsert({
      worker_id: data.worker_id,
      container_id: containerId,
      container_name: data.worker_id,
      session_volume_name: data.worker_id,
      activated_at: currentTime(),
    });

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    void this.centrifugoPublish(dataPublish).catch((err) => {
      console.error('Failed to publish worker available status:', err);
    });

    if (
      connectionRequest &&
      (workerType === EWorkerType.baileys ||
        workerType === EWorkerType.wwebjs ||
        workerType === EWorkerType.whatsmeow)
    ) {
      const payload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: connectionRequest.status,
        type: connectionRequest.type,
        ...(connectionRequest.phone_connection
          ? { phone_connection: connectionRequest.phone_connection }
          : {}),
        ...(connectionRequest.remove_session === true
          ? { remove_session: true }
          : {}),
      };

      this.startConnectionRequestRetry(payload);
    }

    return {} as PublishResult;
  }

  private buildNewContainerHealthOptions(
    overrides: ContainerHealthCheckOptions = {}
  ): ContainerHealthCheckOptions {
    return {
      maxAttempts: 30,
      delayMs: 1000,
      requiredConsecutiveSuccesses: 3,
      failFastAfterFirstSuccessFailures: 3,
      ...overrides,
    };
  }

  private async runCreateWorkerProvisionAttempt(
    data: IWorkerPayload,
    workerType: EWorkerType,
    imageName: ReturnType<typeof getImageWorker>,
    proxy: ResolvedWorkerProxyConfig | undefined,
    proxyMode: 'proxy' | 'direct' | 'direct_fallback' | undefined,
    healthOptions: ContainerHealthCheckOptions,
    createAttempt: number,
    createMaxAttempts: number
  ): Promise<string> {
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.create_attempt_started',
      decision: 'create_worker',
      outcome: 'started',
      worker_type: workerType,
      create_attempt: createAttempt,
      create_max_attempts: createMaxAttempts,
      proxy_status: proxy ? 'configured' : 'disabled',
      proxy_fallback: proxyMode === 'direct_fallback' ? 'direct' : undefined,
    });

    if (
      !(await this.isLifecycleOperationCurrent(data, 'create_worker_attempt'))
    ) {
      throw new WorkerCreateAttemptError(
        'Worker lifecycle operation is stale',
        'stale_lifecycle_operation'
      );
    }

    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType,
        'create_worker_attempt'
      ))
    ) {
      throw new WorkerCreateAttemptError(
        'Worker snapshot changed',
        'worker_snapshot_changed'
      );
    }

    const containerId = await this.retryOperation(
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          createAttempt === 1,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy,
          {
            workerTypeId: workerType,
            workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
            proxyMode: proxyMode ?? (proxy ? 'proxy' : 'direct'),
          }
        ),
      (r) => !r
    );

    if (!containerId) {
      throw new WorkerCreateAttemptError(
        'Failed to create worker container',
        'create_container_failed'
      );
    }

    let healthResult: ContainerHealthResult;
    try {
      healthResult = await this.containerHealthService.checkServiceHealth(
        containerId,
        healthOptions
      );
    } catch (err) {
      await this.recordContainerDiagnosticsSafely(
        data.worker_id,
        'create_health_failed'
      );
      throw new WorkerCreateAttemptError(
        getErrorMessage(err),
        'create_health_failed',
        containerId
      );
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.create_health_result',
      decision: 'check_created_container_health',
      outcome: healthResult.healthy ? 'healthy' : 'unhealthy',
      reason: healthResult.health_failure_reason,
      worker_type: workerType,
      container_id: containerId,
      create_attempt: createAttempt,
      create_max_attempts: createMaxAttempts,
      health_status_code: healthResult.health_status_code || 'none',
      health_attempt: healthResult.health_attempt,
      health_max_attempts: healthResult.health_max_attempts,
      health_delay_ms: healthResult.health_delay_ms,
      health_error: healthResult.health_error,
      consecutive_successes: healthResult.consecutive_successes,
      required_consecutive_successes:
        healthResult.required_consecutive_successes,
      health_duration_ms: healthResult.health_duration_ms,
      health_failure_reason: healthResult.health_failure_reason,
    });

    if (!healthResult.healthy) {
      const reason = this.getCreateHealthFailureReason(healthResult);

      if (reason === 'create_health_flapping_after_success') {
        recordConnectionLifecycle({
          stage:
            'connection.balancer.command_handler.create_health_flapping_after_success',
          decision: 'check_created_container_health',
          outcome: 'failed',
          reason,
          recreate_reason: reason,
          level: 'warn',
          worker_type: workerType,
          container_id: containerId,
          create_attempt: createAttempt,
          create_max_attempts: createMaxAttempts,
          health_status_code: healthResult.health_status_code || 'none',
          health_error: healthResult.health_error,
          consecutive_successes: healthResult.consecutive_successes,
          required_consecutive_successes:
            healthResult.required_consecutive_successes,
        });
      }

      await this.recordContainerDiagnosticsSafely(data.worker_id, reason);
      throw new WorkerCreateAttemptError(
        'Worker service is not healthy',
        reason,
        containerId,
        healthResult
      );
    }

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        await this.waitForWorkerGrpcReady(
          data.worker_id,
          workerType,
          undefined,
          'create'
        );
      } catch (err) {
        await this.recordContainerDiagnosticsSafely(
          data.worker_id,
          'create_grpc_readiness_failed'
        );
        throw new WorkerCreateAttemptError(
          getErrorMessage(err),
          'create_grpc_readiness_failed',
          containerId,
          healthResult
        );
      }
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.create_attempt_success',
      decision: 'create_worker',
      outcome: 'success',
      worker_type: workerType,
      container_id: containerId,
      create_attempt: createAttempt,
      create_max_attempts: createMaxAttempts,
      health_status_code: healthResult.health_status_code || 'none',
      consecutive_successes: healthResult.consecutive_successes,
      required_consecutive_successes:
        healthResult.required_consecutive_successes,
    });

    return containerId;
  }

  private getCreateHealthFailureReason(
    healthResult: ContainerHealthResult
  ): string {
    if (
      healthResult.health_failure_reason === 'health_flapping_after_success'
    ) {
      return 'create_health_flapping_after_success';
    }

    return 'create_health_failed';
  }

  private isStaleCreateAttemptReason(reason: string): boolean {
    return (
      reason === 'stale_lifecycle_operation' ||
      reason === 'worker_snapshot_changed'
    );
  }

  private async prepareCreateWorkerRetry(
    data: IWorkerPayload,
    reason: string,
    createAttempt: number,
    createMaxAttempts: number
  ): Promise<void> {
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.create_attempt_retrying',
      decision: 'create_worker',
      outcome: 'retrying',
      reason,
      recreate_reason: reason,
      worker_type: data.worker_type_id,
      create_attempt: createAttempt,
      create_max_attempts: createMaxAttempts,
    });

    try {
      const removed = await this.workerService.removeContainerWorker(
        data.worker_id,
        false
      );
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.create_retry_container_removed',
        decision: 'remove_failed_created_container',
        outcome: removed ? 'removed' : 'not_removed',
        reason,
        recreate_reason: reason,
        worker_type: data.worker_type_id,
        create_attempt: createAttempt,
        create_max_attempts: createMaxAttempts,
      });
    } catch (err) {
      recordConnectionLifecycle({
        stage:
          'connection.balancer.command_handler.create_retry_container_remove_error',
        decision: 'remove_failed_created_container',
        outcome: 'error',
        reason,
        recreate_reason: reason,
        level: 'warn',
        worker_type: data.worker_type_id,
        create_attempt: createAttempt,
        create_max_attempts: createMaxAttempts,
        error: getErrorMessage(err),
      });
    }
  }

  private async recordContainerDiagnosticsSafely(
    workerId: string,
    reason: string
  ): Promise<void> {
    try {
      await this.workerService.recordContainerDiagnostics(workerId, reason);
    } catch (err) {
      console.error('Failed to record worker container diagnostics', {
        workerId,
        reason,
        error: getErrorMessage(err),
      });
    }
  }

  private readonly sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  private readonly retryOperation = async <T>(
    operation: () => Promise<T>,
    shouldRetry: (result: T) => boolean
  ): Promise<T> => {
    let lastResult: T | undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const result = await operation();
      lastResult = result;
      if (!shouldRetry(result)) return result;
      if (attempt < this.maxRetries) await this.sleep(this.retryIntervalMs);
    }
    if (lastResult === undefined) {
      throw new Error('Retry operation failed: no result');
    }
    return lastResult;
  };
}
