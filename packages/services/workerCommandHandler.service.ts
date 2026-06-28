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
import { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
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
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';
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
import { IWorkerConnectionQrCodeQueueMessage } from '@core/common/interfaces/IWorkerConnectionQrCodeQueueMessage';
import { WorkerConnectionQrCodeRedisQueueService } from '@core/services/workerConnectionQrCodeRedisQueue.service';
import { IWorkerRuntimeHealthResponseProto } from '@core/common/interfaces/IWorkerRuntimeActivationProto';
import {
  ConnectionLifecycleDebugContext,
  ConnectionLifecycleDebugService,
} from '@core/services/connectionLifecycleDebug.service';
import { logLocalConnectionStatus } from '@core/common/functions/localConnectionStatusLog';
import {
  WorkerSelfHealRecoveryState,
  parseWorkerSelfHealRecoveryState,
  workerRecreateServerSlotKey,
  workerSelfHealCooldownKey,
  workerSelfHealInflightKey,
  workerSelfHealRecoveryKey,
} from '@core/common/functions/workerSelfHealingKeys';

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

interface CreateWorkerOptions {
  healthOptions?: ContainerHealthCheckOptions;
  proxyOverride?: ResolvedWorkerProxyConfig | null;
  proxyMode?: 'proxy' | 'direct' | 'direct_fallback';
}

interface ActiveQrAttempt {
  ack: IBaileysConnectionState;
  queued_at: string;
  stream_key: string;
  stream_id?: string;
  consumer_group: string;
  source: 'manager';
  worker_type_id: EWorkerType;
  runtime_generation?: number;
}

interface RecreateSessionVolumeResolution {
  sessionVolumeName?: string;
  runtimeGeneration?: number;
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
  private readonly recreateOnlineReconciliationWaitMs = 10_000;
  private readonly recreateOnlineReconciliationPollIntervalMs = 500;
  private readonly qrAttemptTtlSeconds = 180;
  private readonly qrCacheTtlSeconds = 115;
  private readonly qrMaxAgeMs = 120_000;
  private readonly selfHealInflightTtlSeconds = 20 * 60;
  private readonly selfHealCooldownSeconds = 30 * 60;
  private readonly selfHealRecoveryWindowSeconds = Math.max(
    60,
    Number(process.env.WORKER_SELF_HEAL_RECOVERY_WINDOW_SECONDS) || 10 * 60
  );
  private readonly recreateServerSlotCount = Math.max(
    1,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_COUNT) || 2
  );
  private readonly recreateServerSlotTtlMs = Math.max(
    60_000,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS) || 20 * 60_000
  );
  private readonly recreateServerSlotWaitMs = Math.max(
    60_000,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS) || 30 * 60_000
  );
  private connectionRequestTimers = new Map<string, NodeJS.Timeout>();
  private connectionRequestAttempts = new Map<string, number>();
  private connectionRequestPayloads = new Map<
    string,
    StatusConnectionWorkerRequest
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
    @inject('Redis')
    private readonly redis: Redis,
    @inject(WorkerConnectionQrCodeRedisQueueService)
    private readonly redisQueueService: WorkerConnectionQrCodeRedisQueueService = new WorkerConnectionQrCodeRedisQueueService(
      redis
    ),
    @inject(WorkerWarmPoolRepository)
    private readonly workerWarmPoolRepository: WorkerWarmPoolRepository = undefined as never,
    @inject(WorkerRuntimeRepository)
    private readonly workerRuntimeRepository: WorkerRuntimeRepository = undefined as never,
    @inject(ConnectionLifecycleDebugService)
    private readonly connectionLifecycleDebugService: ConnectionLifecycleDebugService = {
      log: async () => undefined,
    } as unknown as ConnectionLifecycleDebugService
  ) {}

  private logDebug(
    event: string,
    context: ConnectionLifecycleDebugContext
  ): void {
    void this.connectionLifecycleDebugService.log(event, context);
    logLocalConnectionStatus(event, context);
  }

  private optionalRuntimeGeneration(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
    }

    return undefined;
  }

  private normalizePositiveInt(value: unknown, fallback: number): number {
    const parsed =
      typeof value === 'number'
        ? value
        : Number.parseInt(String(value ?? ''), 10);

    return Number.isFinite(parsed) && parsed > 0
      ? Math.trunc(parsed)
      : fallback;
  }

  private async redisSetNxSeconds(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<boolean> {
    const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  private async redisSetNxMs(
    key: string,
    value: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.redis.set(key, value, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  private isSelfHealingBlockedStatus(
    status: EWorkerStatus | undefined
  ): boolean {
    return (
      !status ||
      [
        EWorkerStatus.delete,
        EWorkerStatus.deleting,
        EWorkerStatus.creating,
        EWorkerStatus.recreating,
        EWorkerStatus.stopped,
        EWorkerStatus.new,
      ].includes(status)
    );
  }

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
    const lifecycleContext: ConnectionLifecycleDebugContext = {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      action: data.action,
    };
    this.logDebug('service.command_handler.handle', lifecycleContext);

    if (data.action === EWorkerAction.create) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'create_worker',
        () => this.createWorker(data),
        lifecycleContext
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
        },
        lifecycleContext
      );
      return;
    }

    if (data.action === EWorkerAction.cleanup) {
      await this.runWithWorkerLifecycleLock(
        data.worker_id,
        'cleanup_worker',
        () => this.cleanupWorker(data),
        lifecycleContext
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
        },
        lifecycleContext
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

    await this.workerWarmPoolRepository.create({
      warm_pool_id: data.warm_pool_id,
      server_id: data.server_id,
      worker_type_id: workerType,
      session_volume_name: sessionVolumeName,
      state: EWorkerWarmPoolState.warming,
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
    const sourceInspection =
      await this.workerService.inspectContainerWorkerById(sourceContainerName);
    const rejectionReason = this.validateWarmActivation(
      data,
      warm,
      sourceInspection,
      workerType
    );
    if (rejectionReason) {
      await this.rejectWarmActivation(warm, rejectionReason);
      throw new Error(`Warm pool activation rejected: ${rejectionReason}`);
    }
    if (
      data.lifecycle_operation_id &&
      !(await this.isLifecycleOperationCurrent({
        action: EWorkerAction.create,
        worker_id: data.worker_id,
        account_id: data.account_id,
        server_id: data.server_id,
        worker_type_id: workerType,
        lifecycle_operation_id: data.lifecycle_operation_id,
      }))
    ) {
      await this.rejectWarmActivation(warm, 'stale_lifecycle_operation');
      throw new Error(
        'Warm pool activation rejected: stale_lifecycle_operation'
      );
    }

    await this.invalidateQrAttemptState(data.worker_id, {
      accountId: data.account_id,
      workerType,
      previousWorkerType: data.previous_worker_type_id,
      reason: 'warm_activation_runtime_replacement',
      recreateReason:
        data.remove_volume === true
          ? 'activate_warm_with_volume_reset'
          : 'activate_warm_container_replaced',
      debugTraceId: data.debug_trace_id,
    });

    await this.kafkaBaileysQueueService.ensure(data.worker_id);

    const nextRuntimeGeneration = await this.resolveNextRuntimeGeneration(
      data.worker_id
    );

    await this.removeExistingRuntimeBeforeWarmActivation(
      data,
      sourceContainerName
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
      runtime_generation: nextRuntimeGeneration,
      warm_pool_id: data.warm_pool_id,
      activated_at: currentTime(),
    });

    await this.workerWarmPoolRepository.markAssigned(
      data.warm_pool_id,
      data.worker_id
    );
    await this.cleanupAssignedWarmPoolReferences(data.worker_id, {
      currentWarmPoolId: data.warm_pool_id,
    });
    const shouldClearSessionMetadata =
      data.remove_session === true ||
      data.remove_volume === true ||
      Boolean(
        data.previous_worker_type_id &&
        data.previous_worker_type_id !== workerType
      );
    const workerUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      container_id: activatedInspection.container_id ?? warm.container_id,
      worker_status_id: EWorkerStatus.disponible,
      ...(shouldClearSessionMetadata
        ? { number: null, connection_date: null }
        : {}),
    };

    await this.workerService.updateWorkerById(data.account_id, workerUpdate);

    await this.publishWarmActivationDisponible(
      data,
      workerType,
      activatedInspection.container_id ?? warm.container_id ?? undefined,
      runtime?.runtime_generation
    );

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
    sourceContainerName: string
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
      return;
    }

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
      return;
    }

    const state: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
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
    } catch {}
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
    warm: IWorkerWarmPool,
    reason: string
  ): Promise<void> {
    await this.workerWarmPoolRepository.markRuntime({
      warm_pool_id: warm.warm_pool_id,
      state: EWorkerWarmPoolState.error,
      last_error: reason,
    });
  }

  private async runWithWorkerLifecycleLock<T>(
    workerId: string,
    operation: string,
    callback: () => Promise<T>,
    context?: ConnectionLifecycleDebugContext
  ): Promise<T> {
    const startedAt = Date.now();
    this.logDebug('service.lifecycle_lock.wait', {
      ...context,
      layer: context?.layer ?? 'service',
      worker_id: workerId,
      operation,
    });

    return this.workerLifecycleLockService.withLock(
      workerId,
      operation,
      async () => {
        this.logDebug('service.lifecycle_lock.acquired', {
          ...context,
          layer: context?.layer ?? 'service',
          worker_id: workerId,
          operation,
          duration_ms: Date.now() - startedAt,
        });

        try {
          const result = await callback();
          this.logDebug('service.lifecycle_lock.release', {
            ...context,
            layer: context?.layer ?? 'service',
            worker_id: workerId,
            operation,
            duration_ms: Date.now() - startedAt,
          });
          return result;
        } catch (error) {
          this.logDebug('service.lifecycle_lock.error', {
            ...context,
            layer: context?.layer ?? 'service',
            worker_id: workerId,
            operation,
            duration_ms: Date.now() - startedAt,
            reason: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    );
  }

  async handleChangeConnectionStatus(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<void> {
    await this.handleChangeConnectionStatusWithLifecycle(input, accountId);
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
      connection_attempt_id: input.connection_attempt_id,
      debug_trace_id: input.debug_trace_id,
      runtime_generation: input.runtime_generation,
      warm_pool_id: input.warm_pool_id,
      qr_pending: input.qr_pending,
    };

    this.logDebug('service.command_handler.change_connection_status', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: accountId,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      qr_pending: payload.qr_pending === true,
    });

    if (
      payload.status === EWorkerStatus.online &&
      payload.type === EBaileysConnectionType.qrcode
    ) {
      throw new Error(
        'Use the QR Code request endpoint for QR Code connections.'
      );
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
          await this.workerBaileysGrpcClientService.requestConnection(
            input.worker_id,
            payload,
            workerType
          );
        } catch (err) {
          if (this.isTopicOrPartitionMissing(err)) {
            return;
          }

          throw err;
        }
      },
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      }
    );
  }

  async handleRequestConnectionQrCode(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    return this.handleRequestConnectionQrCodeWithLifecycle(input, accountId);
  }

  private async handleRequestConnectionQrCodeWithLifecycle(
    input: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    if (input.type === EBaileysConnectionType.phone) {
      throw new Error('Phone connection is disabled. Use QR Code.');
    }

    this.stopConnectionRequestRetry(input.worker_id);
    this.logDebug('service.command_handler.qr_request.start', {
      trace_id: input.debug_trace_id,
      layer: 'service',
      worker_id: input.worker_id,
      account_id: accountId,
      connection_attempt_id: input.connection_attempt_id,
      runtime_generation: input.runtime_generation,
      status: input.status,
      qr_pending: input.qr_pending === true,
    });
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
      },
      {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: input.worker_id,
        account_id: accountId,
        connection_attempt_id: input.connection_attempt_id,
        runtime_generation: input.runtime_generation,
        status: input.status,
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
      this.logDebug('service.connection_intent.publish', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      });
      void this.centrifugoPublish({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.awaitConnection,
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        debug_trace_id: payload.debug_trace_id,
      }).catch((err) => {
        console.error('Failed to publish connection start intent:', err);
      });
      return;
    }

    if (payload.status === EWorkerStatus.disponible) {
      this.logDebug('service.connection_intent.publish', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
      });
      void this.centrifugoPublish({
        status: EBaileysConnectionStatus.connecting,
        code: ECodeMessage.logoutInProgress,
        worker_id: payload.worker_id,
        account_id: accountId,
        disconnected_user: true,
        connection_attempt_id: payload.connection_attempt_id,
        debug_trace_id: payload.debug_trace_id,
      }).catch((err) => {
        console.error('Failed to publish connection logout intent:', err);
      });
    }
  }

  async notifyWorkerStatus(
    input: INotifyWorkerStatusRequestProto
  ): Promise<void> {
    const workerStatusId = input.worker_status_id as EWorkerStatus | undefined;
    await this.notifyWorkerStatusWithLifecycle(input, workerStatusId);
  }

  async requestWorkerSelfHealing(
    input: IWorkerSelfHealingRequestProto
  ): Promise<void> {
    const workerId = input.worker_id?.trim();
    const accountId = input.account_id?.trim();
    const workerTypeId = input.worker_type_id?.trim() as
      | EWorkerType
      | undefined;

    if (!workerId || !accountId || !workerTypeId) {
      throw new Error(
        'Missing required fields: worker_id, account_id, worker_type_id'
      );
    }

    if (!Object.values(EWorkerType).includes(workerTypeId)) {
      throw new Error('Invalid worker_type_id');
    }

    const current = await this.workerService.viewWorkerForMonitor(workerId);
    if (
      !current ||
      current.account_id !== accountId ||
      current.worker_type_id !== workerTypeId ||
      current.deleted_at ||
      current.lifecycle_operation_id ||
      this.isSelfHealingBlockedStatus(current.worker_status_id as EWorkerStatus)
    ) {
      this.logDebug('service.self_heal.skipped_worker_not_eligible', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        status: current?.worker_status_id,
        lifecycle_operation_id: current?.lifecycle_operation_id ?? undefined,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const inspection = await this.workerService
      .inspectContainerWorkerById(workerId)
      .catch(() => null);
    if (!inspection?.exists || inspection.running !== true) {
      this.logDebug('service.self_heal.skipped_container_not_running', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const cooldownKey = workerSelfHealCooldownKey(workerId);
    if (await this.redis.get(cooldownKey)) {
      this.logDebug('service.self_heal.skipped_cooldown', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const operationId = uuidv7();
    const inflightKey = workerSelfHealInflightKey(workerId);
    const inflightAcquired = await this.redisSetNxSeconds(
      inflightKey,
      operationId,
      this.selfHealInflightTtlSeconds
    );
    if (!inflightAcquired) {
      this.logDebug('service.self_heal.skipped_inflight', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: workerTypeId,
        source: input.source,
        reason: input.reason,
      });
      return;
    }

    const recoveryWindowSeconds = this.normalizePositiveInt(
      input.recovery_window_seconds,
      this.selfHealRecoveryWindowSeconds
    );
    const now = new Date();
    const deadline = new Date(now.getTime() + recoveryWindowSeconds * 1000);
    const recoveryState: WorkerSelfHealRecoveryState = {
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      source: input.source || 'health_monitor',
      reason: input.reason || 'worker_self_heal_requested',
      provider_state: input.provider_state || undefined,
      degraded_reason: input.degraded_reason || undefined,
      kafka_unhealthy: input.kafka_unhealthy === true,
      runtime_generation: this.optionalRuntimeGeneration(
        input.runtime_generation
      ),
      operation_id: operationId,
      requested_at: now.toISOString(),
      deadline_at: deadline.toISOString(),
      recovery_window_seconds: recoveryWindowSeconds,
      debug_trace_id: input.debug_trace_id || undefined,
    };

    await this.redis.setex(
      workerSelfHealRecoveryKey(workerId),
      recoveryWindowSeconds + 10 * 60,
      JSON.stringify(recoveryState)
    );

    const updateInput: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: operationId,
    };

    const updated = await this.workerService.updateWorkerById(
      accountId,
      updateInput
    );
    if (!updated) {
      await this.redis.del(inflightKey, workerSelfHealRecoveryKey(workerId));
      return;
    }

    const payload: IWorkerPayload = {
      action: EWorkerAction.recreate,
      worker_id: workerId,
      account_id: accountId,
      server_id: current.server_id,
      worker_status_id: EWorkerStatus.recreating,
      worker_type_id: workerTypeId,
      previous_worker_status_id: current.worker_status_id as EWorkerStatus,
      lifecycle_operation_id: operationId,
      debug_trace_id: input.debug_trace_id,
    };

    const statusPayload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      worker_status_id: EWorkerStatus.recreating,
      provider_state: input.provider_state || undefined,
      degraded_reason: input.degraded_reason || input.reason || undefined,
      debug_trace_id: input.debug_trace_id,
    };

    await Promise.all([
      this.centrifugoPublish(statusPayload),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]).catch((error) => {
      console.error('Failed to publish self-heal recreating status', {
        workerId,
        accountId,
        error: getErrorMessage(error),
      });
    });

    this.logDebug('service.self_heal.accepted', {
      trace_id: input.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: workerTypeId,
      lifecycle_operation_id: operationId,
      source: recoveryState.source,
      reason: recoveryState.reason,
      recovery_deadline_at: recoveryState.deadline_at,
    });

    void this.handle(payload)
      .catch((error) => {
        console.error('Worker self-heal recreate failed', {
          workerId,
          accountId,
          workerTypeId,
          error: getErrorMessage(error),
        });
      })
      .finally(() => {
        void this.redis
          .setex(cooldownKey, this.selfHealCooldownSeconds, operationId)
          .catch(() => undefined);
        void this.redis.del(inflightKey).catch(() => undefined);
      });
  }

  private async notifyWorkerStatusWithLifecycle(
    input: INotifyWorkerStatusRequestProto,
    workerStatusId: EWorkerStatus | undefined
  ): Promise<void> {
    const workerId = input.worker_id;
    const accountId = input.account_id;

    if (!workerId || !accountId || !workerStatusId) {
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
    await this.enrichWorkerStatusPayloadWithName(payload, accountId, workerId);
    this.logDebug('service.notify_status.received', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      worker_name: payload.worker_name,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      code: payload.code,
      reason: payload.reason,
      qrcode: payload.qrcode,
      pairing_code: payload.pairing_code,
      worker_status_id: workerStatusId,
      session_ready: payload.session_ready,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
      authenticated: payload.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: payload.degraded_reason,
      phone: payload.phone,
    });
    const shouldPublishAsQrAttempt = this.isNotifyQrAttemptState(payload);
    const shouldResolveWorkerData =
      shouldPublishAsQrAttempt ||
      Boolean(payload.connection_attempt_id) ||
      this.isQrAttemptTerminalState(payload) ||
      workerStatusId === EWorkerStatus.online ||
      payload.runtime_generation !== undefined ||
      Boolean(payload.container_id);
    const resolvedWorkerData = shouldResolveWorkerData
      ? await this.resolveWorkerDataForContainer(workerId, accountId).catch(
          () => {
            return null;
          }
        )
      : null;
    if (resolvedWorkerData) {
      payload.worker_type_id ??= resolvedWorkerData.workerTypeId;
      payload.worker_status_id ??= resolvedWorkerData.workerStatusId;
      payload.runtime_generation ??= resolvedWorkerData.runtimeGeneration;
      payload.warm_pool_id ??= resolvedWorkerData.warmPoolId ?? undefined;
      payload.container_id ??= resolvedWorkerData.containerId ?? undefined;
      this.logDebug('service.notify_status.worker_data_resolved', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        worker_status_id: payload.worker_status_id,
        status: payload.status,
        code: payload.code,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        container_id: payload.container_id,
        warm_pool_id: payload.warm_pool_id,
      });
    }

    const staleRuntimeStatus = this.shouldIgnoreStaleRuntimeNotification(
      payload,
      resolvedWorkerData
    );
    if (staleRuntimeStatus.ignored) {
      this.logDebug('service.notify_status.stale_runtime_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        container_id: payload.container_id,
        status: payload.status,
        code: payload.code,
        worker_status_id: workerStatusId,
        reason: staleRuntimeStatus.reason,
        current_runtime_generation: resolvedWorkerData?.runtimeGeneration,
        current_container_id: resolvedWorkerData?.containerId,
      });
      return;
    }

    const requestedWorkerStatusId = workerStatusId;
    workerStatusId = await this.enforceOnlineNotificationReadiness(
      payload,
      workerStatusId
    );
    workerStatusId = await this.reconcileNonOnlineNotificationReadiness(
      payload,
      workerStatusId
    );
    this.logDebug('service.notify_status.readiness_gate_result', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      requested_worker_status_id: requestedWorkerStatusId,
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      can_send: payload.can_send,
      can_receive_runtime: payload.can_receive_runtime,
      authenticated: payload.authenticated,
      provider_state: payload.provider_state,
      degraded_reason: payload.degraded_reason,
      phone: payload.phone,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
    });

    const isDisponibleWithDisconnectedUser =
      workerStatusId === EWorkerStatus.disponible &&
      input.disconnected_user === true;

    if (isDisponibleWithDisconnectedUser) {
      const updateInput: IUpdateWorker = {
        worker_id: workerId,
        worker_status_id: EWorkerStatus.disponible,
        number: null,
        container_id: null,
        connection_date: null,
      };

      await this.workerService.updateWorkerById(accountId, updateInput);
      this.logDebug('service.notify_status.db_update_disconnected_user', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        worker_status_id: updateInput.worker_status_id,
        status: payload.status,
        code: payload.code,
        number: updateInput.number,
        connection_date: updateInput.connection_date,
        disconnected_user: true,
      });
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
      this.logDebug('service.notify_status.disconnected_user_published', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
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
      return;
    }

    const staleQrAttemptStatus = await this.shouldIgnoreQrAttemptState(payload);
    if (staleQrAttemptStatus.ignored) {
      this.logDebug('service.notify_status.stale_qr_attempt_skipped', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: staleQrAttemptStatus.reason,
        qrcode: payload.qrcode,
        pairing_code: payload.pairing_code,
        worker_status_id: workerStatusId,
      });
      return;
    }

    const view =
      await this.workerService.viewWorkerPhoneConnectionDate(workerId);

    const inputPhone = payload.phone?.trim() || null;
    const phoneNumber = inputPhone ?? view?.number ?? null;

    let connectionDate = view?.connection_date;
    if (workerStatusId === EWorkerStatus.online) {
      connectionDate = currentTime();
    }

    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: workerId,
      status: workerStatusId,
      number: phoneNumber,
      connection_date: connectionDate,
    });
    await this.clearQrAttemptAfterSuccessfulTerminal(payload);
    await this.clearSelfHealRecoveryAfterNotification(payload, workerStatusId);
    this.logDebug('service.notify_status.db_update', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      worker_type_id: payload.worker_type_id,
      worker_status_id: workerStatusId,
      status: payload.status,
      code: payload.code,
      session_ready: payload.session_ready,
      phone: phoneNumber,
      previous_phone: view?.number ?? null,
      connection_date: connectionDate,
      previous_connection_date: view?.connection_date ?? null,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
    });

    let qrAttemptPublished: boolean | undefined;
    if (shouldPublishAsQrAttempt) {
      qrAttemptPublished = await this.cacheAndPublishQrAttemptState(payload);

      if (qrAttemptPublished) {
        await this.centrifugoService.publish(
          channelsConfigCentrifugo(),
          payload
        );
        this.logDebug('service.notify_status.qr_attempt_published', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: workerId,
          account_id: accountId,
          worker_type_id: payload.worker_type_id,
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          status: payload.status,
          code: payload.code,
          reason: payload.reason,
          qrcode: payload.qrcode,
          pairing_code: payload.pairing_code,
        });
      }
    } else {
      await Promise.all([
        this.centrifugoPublish(payload),
        this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
      ]);
      this.logDebug('service.notify_status.published', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: accountId,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.reason,
      });
    }
  }

  private async enrichWorkerStatusPayloadWithName(
    payload: IBaileysConnectionState,
    accountId: string,
    workerId: string
  ): Promise<void> {
    try {
      const worker = await this.workerService.viewWorkerNameAndId(
        accountId,
        workerId
      );
      if (worker?.name) {
        payload.worker_name = worker.name;
      }
    } catch {
      // Worker status publication must continue even when display metadata is unavailable.
    }
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
      worker_type_id: input.worker_type_id
        ? (input.worker_type_id as EWorkerType)
        : undefined,
      worker_status_id: workerStatusId,
      phone: input.phone || undefined,
      disconnected_user: input.disconnected_user ?? undefined,
      connection_attempt_id: input.connection_attempt_id || undefined,
      debug_trace_id: input.debug_trace_id || undefined,
      qrcode: input.qrcode || undefined,
      pairing_code: input.pairing_code || undefined,
      qr_pending: input.qr_pending === true ? true : undefined,
      qr_generated_at: input.qr_generated_at || undefined,
      reason: input.reason || undefined,
      error: input.error || undefined,
      container_id: input.container_id || undefined,
      warm_pool_id: input.warm_pool_id || undefined,
      session_ready:
        input.session_ready !== undefined
          ? input.session_ready === true
          : undefined,
      can_send:
        input.can_send !== undefined ? input.can_send === true : undefined,
      can_receive_runtime:
        input.can_receive_runtime !== undefined
          ? input.can_receive_runtime === true
          : undefined,
      authenticated:
        input.authenticated !== undefined
          ? input.authenticated === true
          : undefined,
      provider_state: input.provider_state || undefined,
      degraded_reason: input.degraded_reason || undefined,
      last_probe_at: input.last_probe_at || undefined,
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
    const probeLatencyMs = this.normalizeNotifyOptionalNumber(
      input.probe_latency_ms
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
    if (probeLatencyMs !== undefined) {
      payload.probe_latency_ms = probeLatencyMs;
    }
    if (payload.qrcode && payload.qr_pending !== true) {
      payload.qr_pending = false;
    }

    return payload;
  }

  private async enforceOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): Promise<EWorkerStatus> {
    if (workerStatusId !== EWorkerStatus.online) {
      return workerStatusId;
    }

    const workerType = payload.worker_type_id as EWorkerType | undefined;
    if (workerType) {
      try {
        const health = await this.workerBaileysGrpcClientService.runtimeHealth(
          payload.worker_id,
          { worker_id: payload.worker_id },
          workerType
        );
        this.logDebug('service.notify_status.session_ready_probe_result', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          worker_status_id: workerStatusId,
          status: payload.status,
          code: payload.code,
          session_ready: health?.session_ready,
          can_send: health?.can_send,
          can_receive_runtime: health?.can_receive_runtime,
          authenticated: health?.authenticated,
          provider_state: health?.provider_state,
          degraded_reason: health?.degraded_reason,
          runtime_generation: health?.runtime_generation,
          runtime_state: health?.runtime_state,
          phone: health?.phone,
          kafka_unhealthy: health?.kafka_unhealthy,
          connection_attempt_id: payload.connection_attempt_id,
        });

        if (
          this.isRuntimeGenerationCompatible(payload, health) &&
          this.isConnectedRuntimeHealth(health, workerType, payload.phone)
        ) {
          this.applyConnectedRuntimeHealthToPayload(payload, health);
          this.logDebug(
            'service.notify_status.session_ready_runtime_confirmed',
            {
              trace_id: payload.debug_trace_id,
              layer: 'service',
              worker_id: payload.worker_id,
              account_id: payload.account_id,
              worker_type_id: workerType,
              worker_status_id: workerStatusId,
              status: payload.status,
              code: payload.code,
              session_ready: payload.session_ready,
              can_send: payload.can_send,
              can_receive_runtime: payload.can_receive_runtime,
              authenticated: payload.authenticated,
              phone: payload.phone,
              connection_attempt_id: payload.connection_attempt_id,
              runtime_generation: payload.runtime_generation,
              runtime_health_generation: health?.runtime_generation,
            }
          );
          return workerStatusId;
        }
      } catch (error) {
        this.logDebug('service.notify_status.session_ready_probe_failed', {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          connection_attempt_id: payload.connection_attempt_id,
          runtime_generation: payload.runtime_generation,
          status: payload.status,
          code: payload.code,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    payload.worker_status_id = EWorkerStatus.disponible;
    payload.status = EBaileysConnectionStatus.connecting;
    payload.code = ECodeMessage.awaitConnection;
    payload.session_ready = false;
    payload.can_send = false;
    payload.can_receive_runtime = false;
    payload.authenticated = false;
    payload.degraded_reason ??= 'online_without_session_ready';

    this.logDebug(
      'service.notify_status.online_rejected_without_session_ready',
      {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: payload.degraded_reason,
      }
    );

    return EWorkerStatus.disponible;
  }

  private shouldIgnoreStaleRuntimeNotification(
    payload: IBaileysConnectionState,
    current: ResolvedWorkerDataForContainer | null
  ): { ignored: boolean; reason?: string } {
    if (!current) {
      return { ignored: false };
    }

    if (
      payload.worker_type_id &&
      current.workerTypeId &&
      payload.worker_type_id !== current.workerTypeId
    ) {
      return { ignored: true, reason: 'runtime_worker_type_mismatch' };
    }

    if (
      payload.container_id &&
      current.containerId &&
      payload.container_id !== current.containerId
    ) {
      return { ignored: true, reason: 'runtime_container_mismatch' };
    }

    if (
      payload.runtime_generation !== undefined &&
      current.runtimeGeneration !== undefined &&
      payload.runtime_generation < current.runtimeGeneration
    ) {
      return { ignored: true, reason: 'runtime_generation_stale' };
    }

    return { ignored: false };
  }

  private shouldProbeNonOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): boolean {
    if (workerStatusId === EWorkerStatus.online) {
      return false;
    }

    if (!payload.worker_type_id) {
      return false;
    }

    if (payload.disconnected_user === true) {
      return false;
    }

    return !this.isStrongSessionInvalidationNotification(payload);
  }

  private isStrongSessionInvalidationNotification(
    payload: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      payload.code === ECodeMessage.logoutInProgress ||
      payload.code === ECodeMessage.loggedOut ||
      payload.code === ECodeMessage.forbidden ||
      payload.code === ECodeMessage.connectionReplaced ||
      payload.code === ECodeMessage.badSession ||
      payload.code === ECodeMessage.multideviceMismatch ||
      payload.code === ECodeMessage.phoneNotAvailable
    );
  }

  private applyConnectedRuntimeHealthToPayload(
    payload: IBaileysConnectionState,
    health: IWorkerRuntimeHealthResponseProto
  ): void {
    payload.worker_status_id = EWorkerStatus.online;
    payload.status = EBaileysConnectionStatus.connected;
    payload.code = ECodeMessage.connectionEstablished;
    payload.session_ready = true;
    payload.can_send = health.can_send === true;
    payload.can_receive_runtime = health.can_receive_runtime === true;
    payload.authenticated = health.authenticated === true;
    payload.provider_state = health.provider_state || undefined;
    payload.degraded_reason = health.degraded_reason || undefined;
    payload.last_probe_at = health.last_probe_at || undefined;
    payload.probe_latency_ms = this.normalizeNotifyOptionalNumber(
      health.probe_latency_ms
    );

    const healthPhone = this.normalizeConnectionPhone(health.phone);
    if (healthPhone) {
      payload.phone = healthPhone;
    }
  }

  private async enrichConnectedPayloadFromRuntimeHealth(
    payload: IBaileysConnectionState
  ): Promise<void> {
    if (payload.phone?.trim() || !payload.worker_type_id) {
      return;
    }

    const workerType = payload.worker_type_id as EWorkerType;

    try {
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        payload.worker_id,
        { worker_id: payload.worker_id },
        workerType
      );
      this.logDebug('service.notify_status.connected_payload_enrich_result', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        status: payload.status,
        code: payload.code,
        session_ready: health?.session_ready,
        provider_state: health?.provider_state,
        phone: health?.phone,
        connection_attempt_id: payload.connection_attempt_id,
      });

      if (this.isConnectedRuntimeHealth(health, workerType, payload.phone)) {
        this.applyConnectedRuntimeHealthToPayload(payload, health);
      }
    } catch (error) {
      this.logDebug('service.notify_status.connected_payload_enrich_failed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        status: payload.status,
        code: payload.code,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async reconcileNonOnlineNotificationReadiness(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): Promise<EWorkerStatus> {
    if (
      !this.shouldProbeNonOnlineNotificationReadiness(payload, workerStatusId)
    ) {
      return workerStatusId;
    }

    const workerType = payload.worker_type_id as EWorkerType;

    try {
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        payload.worker_id,
        { worker_id: payload.worker_id },
        workerType
      );
      this.logDebug('service.notify_status.non_online_probe_result', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        requested_worker_status_id: workerStatusId,
        status: payload.status,
        code: payload.code,
        session_ready: health?.session_ready,
        can_send: health?.can_send,
        can_receive_runtime: health?.can_receive_runtime,
        authenticated: health?.authenticated,
        provider_state: health?.provider_state,
        degraded_reason: health?.degraded_reason,
        runtime_generation: health?.runtime_generation,
        runtime_state: health?.runtime_state,
        phone: health?.phone,
        connection_attempt_id: payload.connection_attempt_id,
      });

      if (!this.isConnectedRuntimeHealth(health, workerType, payload.phone)) {
        return workerStatusId;
      }

      this.applyConnectedRuntimeHealthToPayload(payload, health);
      this.logDebug(
        'service.notify_status.non_online_promoted_by_runtime_health',
        {
          trace_id: payload.debug_trace_id,
          layer: 'service',
          worker_id: payload.worker_id,
          account_id: payload.account_id,
          worker_type_id: workerType,
          requested_worker_status_id: workerStatusId,
          worker_status_id: EWorkerStatus.online,
          status: payload.status,
          code: payload.code,
          session_ready: payload.session_ready,
          can_send: payload.can_send,
          can_receive_runtime: payload.can_receive_runtime,
          authenticated: payload.authenticated,
          provider_state: payload.provider_state,
          degraded_reason: payload.degraded_reason,
          phone: payload.phone,
          connection_attempt_id: payload.connection_attempt_id,
        }
      );

      return EWorkerStatus.online;
    } catch (error) {
      this.logDebug('service.notify_status.non_online_probe_failed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: payload.account_id,
        worker_type_id: workerType,
        connection_attempt_id: payload.connection_attempt_id,
        runtime_generation: payload.runtime_generation,
        status: payload.status,
        code: payload.code,
        reason: error instanceof Error ? error.message : String(error),
      });
      return workerStatusId;
    }
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
    } catch {
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
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );
    const workerType =
      workerData?.workerTypeId ??
      (await this.resolveWorkerTypeForConnection(workerId, accountId));

    const existsContainer =
      await this.workerService.existsContainerWorkerById(workerId);
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
      if (healthy) {
        this.startConnectionRequestRetry(payload);
        return;
      }
    }

    if (!workerData) {
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    await this.createWorkerWithPayload(workerId, workerData, payload);
  }

  private qrAttemptCacheKey(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): string {
    return workerTypeId
      ? `connection:qrcode:${workerTypeId}:${workerId}:attempt`
      : `connection:qrcode:${workerId}:attempt`;
  }

  private activeQrAttemptKey(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): string {
    return workerTypeId
      ? `connection:qrcode:${workerTypeId}:${workerId}:active_attempt`
      : `connection:qrcode:${workerId}:active_attempt`;
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

  private qrExpiresAt(
    state: Partial<IBaileysConnectionState>
  ): string | undefined {
    const generatedAtMs = this.qrGeneratedAtMs(state);
    if (generatedAtMs === undefined) {
      return undefined;
    }

    return new Date(generatedAtMs + this.qrMaxAgeMs).toISOString();
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
    delete pending.expires_at;
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
    normalized.expires_at ??= this.qrExpiresAt(normalized);

    if (!this.isQrExpired(normalized)) {
      normalized.qr_pending = false;
      return normalized;
    }

    return this.buildPendingStateFromExpiredQr(normalized);
  }

  private async getCachedQrAttemptState(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): Promise<IBaileysConnectionState | undefined> {
    try {
      const raw = await this.redis.get(
        this.qrAttemptCacheKey(workerId, workerTypeId)
      );
      if (!raw) {
        return undefined;
      }

      const parsed = JSON.parse(raw) as Partial<IBaileysConnectionState>;
      if (!parsed.worker_id || parsed.worker_id !== workerId) {
        return undefined;
      }

      const state = parsed as IBaileysConnectionState;
      if (this.isQrExpired(state)) {
        await this.redis.del(this.qrAttemptCacheKey(workerId, workerTypeId));
        return undefined;
      }

      return state;
    } catch {
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

  private isQrAttemptSuccessfulTerminalState(
    state: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      state.status === EBaileysConnectionStatus.connected ||
      state.worker_status_id === EWorkerStatus.online ||
      state.code === ECodeMessage.connectionEstablished
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
    const workerData = await this.resolveWorkerDataForContainer(
      input.worker_id,
      accountId
    );
    const cached = await this.getCachedQrAttemptState(
      input.worker_id,
      workerData?.workerTypeId
    );
    const cachedIdentityMismatch = cached
      ? this.getCachedQrIdentityMismatchReason(cached, workerData)
      : undefined;
    if (cached && cachedIdentityMismatch) {
      await this.redis.del(
        this.qrAttemptCacheKey(input.worker_id, workerData?.workerTypeId)
      );
      this.logDebug('service.qr_request.cached_state_invalidated', {
        trace_id: input.debug_trace_id,
        layer: 'service',
        worker_id: input.worker_id,
        account_id: accountId,
        worker_type_id: workerData?.workerTypeId,
        runtime_generation: workerData?.runtimeGeneration,
        connection_attempt_id: cached.connection_attempt_id,
        reason: cachedIdentityMismatch,
      });
    }

    const activeCached =
      this.isActiveQrAttemptState(cached) && !cachedIdentityMismatch
        ? cached
        : undefined;
    const connectionAttemptId =
      activeCached?.connection_attempt_id ??
      input.connection_attempt_id ??
      uuidv7();
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: connectionAttemptId,
      debug_trace_id: input.debug_trace_id,
      runtime_generation:
        input.runtime_generation ?? workerData?.runtimeGeneration,
      warm_pool_id: input.warm_pool_id ?? workerData?.warmPoolId ?? undefined,
    };

    if (!activeCached) {
      this.logDebug('service.qr_request.payload_resolved', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: workerData?.workerTypeId,
        runtime_generation: payload.runtime_generation,
        connection_attempt_id: payload.connection_attempt_id,
        cached: false,
      });
      return { payload, shouldReturnCached: false };
    }

    if (activeCached.qrcode || activeCached.qr_pending === true) {
      this.logDebug('service.qr_request.cached_state_returnable', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: payload.worker_id,
        account_id: accountId,
        worker_type_id: activeCached.worker_type_id ?? workerData?.workerTypeId,
        runtime_generation:
          activeCached.runtime_generation ?? payload.runtime_generation,
        connection_attempt_id: payload.connection_attempt_id,
        qrcode: activeCached.qrcode,
        pairing_code: activeCached.pairing_code,
        qr_pending: activeCached.qr_pending === true,
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
      workerData.runtimeGeneration !== undefined &&
      cached.runtime_generation === undefined
    ) {
      return 'cached_qr_missing_runtime_generation';
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
      debug_trace_id: payload.debug_trace_id,
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
      runtime_generation:
        state.runtime_generation ?? payload.runtime_generation,
      debug_trace_id: state.debug_trace_id ?? payload.debug_trace_id,
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
      runtime_generation:
        state.runtime_generation ?? payload.runtime_generation,
      debug_trace_id: state.debug_trace_id ?? payload.debug_trace_id,
      expires_at: state.expires_at ?? this.qrExpiresAt(state),
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
      debug_trace_id: response.debug_trace_id ?? payload.debug_trace_id,
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
      normalized.qr_generated_at ??= new Date().toISOString();
      normalized.expires_at ??= this.qrExpiresAt(normalized);
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

  private async cacheQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<void> {
    const ttlSeconds = this.qrCacheTtlForState(state);
    await this.redis.setex(
      this.qrAttemptCacheKey(state.worker_id, state.worker_type_id),
      ttlSeconds,
      JSON.stringify(state)
    );
  }

  private async getActiveQrAttempt(
    workerId: string,
    workerTypeId?: EWorkerType | string
  ): Promise<ActiveQrAttempt | null> {
    const raw = await this.redis.get(
      this.activeQrAttemptKey(workerId, workerTypeId)
    );
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as ActiveQrAttempt;
      if (!parsed?.ack?.connection_attempt_id) {
        return null;
      }
      return parsed;
    } catch {
      await this.redis.del(this.activeQrAttemptKey(workerId, workerTypeId));
      return null;
    }
  }

  private async claimActiveQrAttempt(
    workerId: string,
    workerTypeId: EWorkerType,
    attempt: ActiveQrAttempt
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.activeQrAttemptKey(workerId, workerTypeId),
      JSON.stringify(attempt),
      'EX',
      this.qrAttemptTtlSeconds,
      'NX'
    );
    return result === 'OK';
  }

  private async clearQrAttemptAfterEnqueueFailure(
    workerId: string,
    workerTypeId: EWorkerType,
    connectionAttemptId?: string
  ): Promise<void> {
    await this.redis.del(this.qrAttemptCacheKey(workerId, workerTypeId));
    if (!connectionAttemptId) {
      return;
    }

    const active = await this.getActiveQrAttempt(workerId, workerTypeId);
    if (active?.ack.connection_attempt_id === connectionAttemptId) {
      await this.redis.del(this.activeQrAttemptKey(workerId, workerTypeId));
    }
  }

  private async clearQrAttemptAfterSuccessfulTerminal(
    state: IBaileysConnectionState
  ): Promise<void> {
    if (
      !this.isQrAttemptSuccessfulTerminalState(state) ||
      !state.worker_type_id
    ) {
      return;
    }

    await this.redis.del(
      this.qrAttemptCacheKey(state.worker_id, state.worker_type_id)
    );

    if (!state.connection_attempt_id) {
      return;
    }

    const active = await this.getActiveQrAttempt(
      state.worker_id,
      state.worker_type_id
    );
    if (active?.ack.connection_attempt_id === state.connection_attempt_id) {
      await this.redis.del(
        this.activeQrAttemptKey(state.worker_id, state.worker_type_id)
      );
    }
  }

  private async invalidateQrAttemptState(
    workerId: string,
    options: {
      accountId?: string;
      workerType?: EWorkerType;
      previousWorkerType?: EWorkerType | string;
      reason: string;
      recreateReason?: string;
      debugTraceId?: string;
    }
  ): Promise<void> {
    try {
      this.logDebug('service.qr_state.invalidate', {
        trace_id: options.debugTraceId,
        layer: 'service',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type_id: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
      });
      const result = await this.redisQueueService.invalidateWorkerState(
        workerId,
        {
          accountId: options.accountId,
          workerTypeId: options.workerType,
          previousWorkerTypeId: options.previousWorkerType,
          reason: options.reason,
          recreateReason: options.recreateReason,
          source: 'worker_command_handler',
          debugTraceId: options.debugTraceId,
        }
      );
      this.logDebug('service.qr_state.invalidated', {
        trace_id: options.debugTraceId,
        layer: 'service',
        worker_id: workerId,
        account_id: options.accountId,
        worker_type_id: options.workerType,
        reason: options.reason,
        recreate_reason: options.recreateReason,
        duration_ms: result.duration_ms,
        deleted_keys: result.deleted_keys,
        scanned_processed_keys: result.scanned_processed_keys,
      });
    } catch {}
  }

  private async cleanupAssignedWarmPoolReferences(
    workerId: string,
    options: {
      currentWarmPoolId?: string | null;
    } = {}
  ): Promise<void> {
    try {
      const deleted =
        await this.workerWarmPoolRepository?.deleteAssignedByWorkerId(
          workerId,
          options.currentWarmPoolId
        );

      if (!deleted) {
        return;
      }
    } catch {}
  }

  private async shouldIgnoreQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<{ ignored: boolean; reason?: string }> {
    const isTerminal = this.isQrAttemptTerminalState(state);
    const isQrAttemptState = this.isNotifyQrAttemptState(state);
    const hasQrCredential = Boolean(state.qrcode || state.pairing_code);
    const allowAttemptMismatch =
      hasQrCredential || this.isQrAttemptSuccessfulTerminalState(state);

    if (state.disconnected_user === true) {
      return { ignored: false };
    }

    if (this.isQrAttemptSuccessfulTerminalState(state)) {
      return { ignored: false };
    }

    if (!isTerminal && !isQrAttemptState) {
      return { ignored: false };
    }

    if (
      hasQrCredential &&
      (!state.connection_attempt_id || !state.worker_type_id)
    ) {
      return {
        ignored: true,
        reason: !state.connection_attempt_id
          ? 'incoming_connection_attempt_missing'
          : 'incoming_worker_type_missing',
      };
    }

    const active = await this.getActiveQrAttempt(
      state.worker_id,
      state.worker_type_id
    );
    if (active) {
      const activeAttempt = active.ack.connection_attempt_id;
      const incomingAttempt = state.connection_attempt_id;
      const activeRuntimeGeneration =
        active.runtime_generation ?? active.ack.runtime_generation;

      if (
        active.worker_type_id &&
        state.worker_type_id &&
        active.worker_type_id !== state.worker_type_id
      ) {
        return {
          ignored: true,
          reason: 'active_worker_type_mismatch',
        };
      }

      if (
        !isTerminal &&
        state.runtime_generation !== undefined &&
        activeRuntimeGeneration === undefined
      ) {
        return {
          ignored: true,
          reason: 'active_runtime_generation_missing',
        };
      }

      if (activeRuntimeGeneration !== undefined) {
        if (!isTerminal && state.runtime_generation === undefined) {
          return {
            ignored: true,
            reason: 'incoming_runtime_generation_missing',
          };
        }

        if (
          state.runtime_generation !== undefined &&
          activeRuntimeGeneration !== state.runtime_generation
        ) {
          return {
            ignored: true,
            reason: 'active_runtime_generation_mismatch',
          };
        }
      }

      if (!isTerminal && !incomingAttempt) {
        return {
          ignored: true,
          reason: 'incoming_connection_attempt_missing',
        };
      }

      if (activeAttempt && activeAttempt !== incomingAttempt) {
        if (allowAttemptMismatch) {
          return { ignored: false };
        }

        return {
          ignored: true,
          reason: 'active_attempt_mismatch',
        };
      }

      if (!state.qrcode) {
        const cached = await this.getCachedQrAttemptState(
          state.worker_id,
          state.worker_type_id
        );
        if (
          this.isActiveQrAttemptState(cached) &&
          cached.connection_attempt_id === incomingAttempt &&
          Boolean(cached.qrcode)
        ) {
          return {
            ignored: true,
            reason: 'cached_qr_wins_over_without_qr',
          };
        }
      }

      return { ignored: false };
    }

    const cached = await this.getCachedQrAttemptState(
      state.worker_id,
      state.worker_type_id
    );
    if (!this.isActiveQrAttemptState(cached)) {
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
      if (allowAttemptMismatch) {
        return { ignored: false };
      }

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
      workerType?: EWorkerType;
    } = {}
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
      return false;
    }
    const normalizedState = this.normalizeQrFreshness(stateWithIdentity);
    const stale = await this.shouldIgnoreQrAttemptState(normalizedState);
    if (stale.ignored) {
      this.logDebug('service.qr_attempt.cache_skip', {
        trace_id: normalizedState.debug_trace_id,
        layer: 'service',
        worker_id: normalizedState.worker_id,
        account_id: normalizedState.account_id,
        worker_type_id: normalizedState.worker_type_id,
        connection_attempt_id: normalizedState.connection_attempt_id,
        runtime_generation: normalizedState.runtime_generation,
        status: normalizedState.status,
        code: normalizedState.code,
        reason: stale.reason,
        qrcode: normalizedState.qrcode,
        pairing_code: normalizedState.pairing_code,
      });
      return false;
    }

    try {
      await this.cacheQrAttemptState(normalizedState);
      this.logDebug('service.qr_attempt.cached', {
        trace_id: normalizedState.debug_trace_id,
        layer: 'service',
        worker_id: normalizedState.worker_id,
        account_id: normalizedState.account_id,
        worker_type_id: normalizedState.worker_type_id,
        connection_attempt_id: normalizedState.connection_attempt_id,
        runtime_generation: normalizedState.runtime_generation,
        status: normalizedState.status,
        code: normalizedState.code,
        reason: normalizedState.reason,
        qrcode: normalizedState.qrcode,
        pairing_code: normalizedState.pairing_code,
      });
    } catch {}

    if (normalizedState.account_id) {
      try {
        await this.centrifugoPublish(normalizedState);
        this.logDebug('service.qr_attempt.centrifugo_published', {
          trace_id: normalizedState.debug_trace_id,
          layer: 'service',
          worker_id: normalizedState.worker_id,
          account_id: normalizedState.account_id,
          worker_type_id: normalizedState.worker_type_id,
          connection_attempt_id: normalizedState.connection_attempt_id,
          runtime_generation: normalizedState.runtime_generation,
          status: normalizedState.status,
          code: normalizedState.code,
          reason: normalizedState.reason,
          qrcode: normalizedState.qrcode,
          pairing_code: normalizedState.pairing_code,
        });
      } catch {}
    }

    return true;
  }

  private async hydrateQrAttemptIdentity(
    state: IBaileysConnectionState
  ): Promise<IBaileysConnectionState> {
    try {
      const raw = await this.redis.get(
        this.activeQrAttemptKey(state.worker_id, state.worker_type_id)
      );
      if (!raw) {
        return state;
      }

      const parsed = JSON.parse(raw) as {
        ack?: Partial<IBaileysConnectionState>;
        worker_type_id?: EWorkerType;
        runtime_generation?: number | string;
      };
      const ack = parsed.ack;
      if (!ack || ack.worker_id !== state.worker_id) {
        return state;
      }

      const hydrated: IBaileysConnectionState = {
        ...state,
        connection_attempt_id:
          state.connection_attempt_id ?? ack.connection_attempt_id,
        debug_trace_id: state.debug_trace_id ?? ack.debug_trace_id,
        worker_type_id:
          state.worker_type_id ?? ack.worker_type_id ?? parsed.worker_type_id,
        runtime_generation:
          state.runtime_generation ??
          ack.runtime_generation ??
          this.optionalRuntimeGeneration(parsed.runtime_generation),
        warm_pool_id: state.warm_pool_id ?? ack.warm_pool_id,
        container_id: state.container_id ?? ack.container_id,
      };

      return hydrated;
    } catch {
      return state;
    }
  }

  private async runConnectionQrCodeWorkflow(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<IBaileysConnectionState> {
    const workerId = payload.worker_id;
    this.ensureQrConnectionAttemptId(payload);
    this.logDebug('service.qr_workflow.start', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: accountId,
      connection_attempt_id: payload.connection_attempt_id,
      runtime_generation: payload.runtime_generation,
      status: payload.status,
      qr_pending: payload.qr_pending === true,
    });
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );

    if (!workerData) {
      throw new Error(`Worker data not found for connection: ${workerId}`);
    }

    const pending = this.buildQrPendingState(
      payload,
      workerData.accountIdResolved,
      {
        reason: 'qrcode_redis_stream_start',
        runtimeGeneration: workerData.runtimeGeneration,
        warmPoolId: workerData.warmPoolId,
        containerId: workerData.containerId,
      }
    );
    pending.worker_type_id = workerData.workerTypeId;
    pending.worker_status_id = workerData.workerStatusId;
    this.logDebug('service.qr_workflow.worker_resolved', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: pending.connection_attempt_id,
      runtime_generation: workerData.runtimeGeneration,
      status: workerData.workerStatusId,
      container_id: workerData.containerId,
      warm_pool_id: workerData.warmPoolId,
    });

    const streamKey = this.redisQueueService.streamKey(
      workerId,
      workerData.workerTypeId
    );
    const consumerGroup = this.redisQueueService.consumerGroup(
      workerId,
      workerData.workerTypeId
    );
    const activeAttempt: ActiveQrAttempt = {
      ack: pending,
      queued_at: new Date().toISOString(),
      stream_key: streamKey,
      consumer_group: consumerGroup,
      source: 'manager',
      worker_type_id: workerData.workerTypeId,
      runtime_generation: workerData.runtimeGeneration,
    };
    const claimed = await this.claimActiveQrAttempt(
      workerId,
      workerData.workerTypeId,
      activeAttempt
    );
    this.logDebug('service.qr_workflow.active_attempt_claimed', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: workerId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: pending.connection_attempt_id,
      runtime_generation: workerData.runtimeGeneration,
      claimed,
    });
    if (!claimed) {
      const current = await this.getActiveQrAttempt(
        workerId,
        workerData.workerTypeId
      );
      if (current) {
        const currentRuntimeGeneration =
          current.runtime_generation ?? current.ack.runtime_generation;
        if (
          workerData.runtimeGeneration !== undefined &&
          (currentRuntimeGeneration === undefined ||
            currentRuntimeGeneration !== workerData.runtimeGeneration)
        ) {
          await this.redis.del(
            this.activeQrAttemptKey(workerId, workerData.workerTypeId)
          );
        } else {
          this.logDebug('service.qr_workflow.active_attempt_returned', {
            trace_id: payload.debug_trace_id,
            layer: 'service',
            worker_id: workerId,
            account_id: workerData.accountIdResolved,
            worker_type_id: workerData.workerTypeId,
            connection_attempt_id: current.ack.connection_attempt_id,
            runtime_generation:
              current.runtime_generation ?? current.ack.runtime_generation,
            reason: current.ack.reason ?? 'queued',
          });
          return {
            ...current.ack,
            debug_trace_id: payload.debug_trace_id,
            worker_type_id: workerData.workerTypeId,
            worker_status_id: workerData.workerStatusId,
            qr_pending: true,
            qrcode: undefined,
            pairing_code: undefined,
            reason: current.ack.reason ?? 'queued',
          };
        }
      }

      const reclaimed = await this.claimActiveQrAttempt(
        workerId,
        workerData.workerTypeId,
        activeAttempt
      );
      this.logDebug('service.qr_workflow.active_attempt_reclaimed', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: workerData.accountIdResolved,
        worker_type_id: workerData.workerTypeId,
        connection_attempt_id: pending.connection_attempt_id,
        runtime_generation: workerData.runtimeGeneration,
        claimed: reclaimed,
      });
      if (!reclaimed) {
        throw new Error('Unable to claim active QR Code attempt.');
      }
    }

    await this.cacheAndPublishQrAttemptState(pending, {
      workerType: workerData.workerTypeId,
    });

    const queueRequest: StatusConnectionWorkerRequest = {
      ...payload,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      runtime_generation: workerData.runtimeGeneration,
      warm_pool_id: workerData.warmPoolId ?? undefined,
      qr_pending: true,
    };

    try {
      await this.enqueueQrCodeRedisStream(queueRequest, workerData);
      return pending;
    } catch (err) {
      await this.clearQrAttemptAfterEnqueueFailure(
        workerId,
        workerData.workerTypeId,
        queueRequest.connection_attempt_id
      );
      throw err;
    }
  }

  private async enqueueQrCodeRedisStream(
    payload: StatusConnectionWorkerRequest,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<void> {
    const queuePayload: IWorkerConnectionQrCodeQueueMessage = {
      request_id: uuidv7(),
      connection_attempt_id: this.ensureQrConnectionAttemptId(payload),
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      runtime_generation: payload.runtime_generation,
      source: 'manager',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.qrMaxAgeMs).toISOString(),
      debug_trace_id: payload.debug_trace_id,
    };

    this.logDebug('service.qr_workflow.redis_enqueue', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: queuePayload.connection_attempt_id,
      runtime_generation: queuePayload.runtime_generation,
    });
    const streamId = await this.redisQueueService.enqueue(queuePayload);
    this.logDebug('service.qr_workflow.redis_enqueued', {
      trace_id: payload.debug_trace_id,
      layer: 'service',
      worker_id: payload.worker_id,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
      connection_attempt_id: queuePayload.connection_attempt_id,
      runtime_generation: queuePayload.runtime_generation,
      stream_id: streamId,
    });
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
    timeoutMs?: number
  ): Promise<string> {
    return this.workerBaileysGrpcClientService.waitForReady(
      workerId,
      workerType,
      timeoutMs
    );
  }

  private async tryRequestConnection(
    workerId: string,
    payload: StatusConnectionWorkerRequest,
    workerType?: EWorkerType
  ): Promise<boolean> {
    try {
      await this.workerBaileysGrpcClientService.requestConnection(
        workerId,
        payload,
        workerType
      );
      return true;
    } catch (err) {
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
      return result.healthy;
    } catch (err) {
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

  private async isLifecycleOperationCurrent(
    data: IWorkerPayload,
    options: { allowServerMismatch?: boolean } = {}
  ): Promise<boolean> {
    if (!data.lifecycle_operation_id) {
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
      return false;
    }

    return true;
  }

  private async isWorkerSnapshotCurrent(
    workerId: string,
    accountId: string,
    serverId: string,
    workerTypeId: EWorkerType
  ): Promise<boolean> {
    const current = await this.workerService.viewWorkerForMonitor(workerId);
    const isCurrent = Boolean(
      current &&
      current.account_id === accountId &&
      current.server_id === serverId &&
      current.worker_type_id === workerTypeId
    );

    if (!isCurrent) {
      return false;
    }

    return true;
  }

  private async updateWorkerWithLifecycleGuard(
    accountId: string,
    input: IUpdateWorker,
    data: IWorkerPayload,
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
      workerTypeId ?? data.worker_type_id ?? ('' as EWorkerType)
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
    workerTypeId?: EWorkerType
  ): Promise<boolean> {
    if (data.lifecycle_operation_id) {
      return this.updateWorkerWithLifecycleGuard(
        accountId,
        input,
        data,
        workerTypeId
      );
    }

    return this.retryOperation(
      async () =>
        this.updateWorkerWithLifecycleGuard(
          accountId,
          input,
          data,
          workerTypeId
        ),
      (r) => !r
    );
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
      return {} as PublishResult;
    }

    try {
      const result = await this.centrifugoService.publishSub(
        channel,
        dataPublish
      );
      return result;
    } catch (err) {
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
    const runtimeBeforeRemove =
      (await this.workerRuntimeRepository?.viewByWorkerId(data.worker_id)) ??
      null;

    if (shouldRemoveVolume) {
      return {
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
        source: 'reset',
        runtimeWasBackfilled: false,
      };
    }

    const runtimeVolume = this.optionalNonEmpty(
      runtimeBeforeRemove?.session_volume_name
    );

    if (runtimeVolume) {
      return {
        sessionVolumeName: runtimeVolume,
        runtimeGeneration: runtimeBeforeRemove?.runtime_generation,
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

    let runtimeGeneration: number | undefined;
    if (inspection.exists && this.workerRuntimeRepository) {
      const volumeExists =
        await this.workerService.existsVolumeByName(sessionVolumeName);

      if (volumeExists) {
        const runtime = await this.workerRuntimeRepository.upsert({
          worker_id: data.worker_id,
          container_id: inspection.container_id,
          container_name: inspection.container_name ?? data.worker_id,
          session_volume_name: sessionVolumeName,
          activated_at: currentTime(),
        });
        runtimeGeneration = runtime?.runtime_generation;
      }
    }

    return {
      sessionVolumeName,
      runtimeGeneration,
      source,
      runtimeWasBackfilled: inspection.exists,
    };
  }

  private async assertPreservedSessionVolumeExists(
    data: IWorkerPayload,
    resolution: RecreateSessionVolumeResolution
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
    try {
      return await this.runWithRecreateServerSlot(data, () =>
        this.performRecreateWorker(data)
      );
    } catch (error) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      ).catch(() => undefined);
      throw error;
    }
  }

  private async performRecreateWorker(
    data: IWorkerPayload
  ): Promise<PublishResult> {
    this.logDebug('service.recreate_worker.start', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
      remove_session: data.remove_session === true,
      remove_volume: data.remove_volume === true,
    });
    if (!(await this.isLifecycleOperationCurrent(data))) {
      this.logDebug('service.recreate_worker.stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'lifecycle_operation_not_current',
      });
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
    const nextRuntimeGeneration = this.incrementRuntimeGeneration(
      sessionVolumeResolution.runtimeGeneration
    );
    const preservedSessionVolumeName =
      sessionVolumeResolution.sessionVolumeName;

    if (!(await this.isLifecycleOperationCurrent(data))) {
      return {} as PublishResult;
    }

    await this.invalidateQrAttemptState(data.worker_id, {
      accountId: data.account_id,
      workerType,
      previousWorkerType: data.previous_worker_type_id,
      reason: 'worker_recreate',
      recreateReason: shouldRemoveVolume
        ? 'recreate_with_volume_reset'
        : 'recreate_container_replaced',
      debugTraceId: data.debug_trace_id,
    });

    if (shouldRemoveSession && shouldRemoveVolume) {
    } else if (shouldRemoveSession) {
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        debug_trace_id: data.debug_trace_id,
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
        sessionVolumeResolution
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
    this.logDebug('service.recreate_worker.container_removed', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      remove_volume: shouldRemoveVolume,
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

    const proxy = await this.resolveWorkerProxyConfig(
      data.worker_id,
      data.server_id
    );

    if (!(await this.isLifecycleOperationCurrent(data))) {
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
    this.logDebug('service.recreate_worker.container_created', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
    });

    const healthy = await this.containerHealthService.isServiceHealthy(
      containerId,
      this.buildNewContainerHealthOptions()
    );

    if (!healthy) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id,
        data.lifecycle_operation_id
      );
      throw new Error('Worker service is not healthy');
    }
    this.logDebug('service.recreate_worker.health_ready', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
    });

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        await this.waitForWorkerGrpcReady(data.worker_id, workerType);
        this.logDebug('service.recreate_worker.grpc_ready', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
        });
      } catch (err) {
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
      runtime_generation: nextRuntimeGeneration,
      activated_at: currentTime(),
    });
    await this.cleanupAssignedWarmPoolReferences(data.worker_id);

    const result = await this.publishWorkerRecreateFinalState(
      data,
      reconciliation
    );
    this.logDebug('service.recreate_worker.final_state_published', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      status: reconciliation.connectionState?.status,
      worker_status_id: reconciliation.workerStatusId,
    });
    return result;
  }

  private async runWithRecreateServerSlot<T>(
    data: IWorkerPayload,
    callback: () => Promise<T>
  ): Promise<T> {
    const token = `${data.worker_id}:${data.lifecycle_operation_id ?? uuidv7()}`;
    const startedAt = Date.now();
    let slotKey: string | null = null;

    while (Date.now() - startedAt <= this.recreateServerSlotWaitMs) {
      for (let slot = 0; slot < this.recreateServerSlotCount; slot++) {
        const key = workerRecreateServerSlotKey(data.server_id, slot);
        if (await this.redisSetNxMs(key, token, this.recreateServerSlotTtlMs)) {
          slotKey = key;
          this.logDebug('service.recreate_worker.server_slot_acquired', {
            trace_id: data.debug_trace_id,
            layer: 'service',
            worker_id: data.worker_id,
            account_id: data.account_id,
            worker_type_id: data.worker_type_id,
            lifecycle_operation_id: data.lifecycle_operation_id,
            server_id: data.server_id,
            slot,
            wait_ms: Date.now() - startedAt,
          });
          break;
        }
      }

      if (slotKey) {
        break;
      }

      await this.sleep(1000);
    }

    if (!slotKey) {
      throw new Error(
        `Timed out waiting for recreate slot on server ${data.server_id}`
      );
    }

    try {
      return await callback();
    } finally {
      await this.releaseRecreateServerSlot(slotKey, token);
    }
  }

  private async releaseRecreateServerSlot(
    slotKey: string,
    token: string
  ): Promise<void> {
    try {
      const current = await this.redis.get(slotKey);
      if (current === token) {
        await this.redis.del(slotKey);
      }
    } catch {
      await this.redis.del(slotKey).catch(() => undefined);
    }
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
      debug_trace_id: data.debug_trace_id,
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
    return data.remove_session !== true;
  }

  private isConnectedConnectionState(
    state: IBaileysConnectionState | undefined
  ): boolean {
    return (
      this.isStrictConnectedPayload(state ?? {}) &&
      (state?.worker_status_id === EWorkerStatus.online ||
        state?.status === EBaileysConnectionStatus.connected ||
        state?.code === ECodeMessage.connectionEstablished)
    );
  }

  private isConnectedRuntimeHealth(
    health: IWorkerRuntimeHealthResponseProto | undefined,
    workerType: EWorkerType,
    phoneFallback?: string | null
  ): boolean {
    return (
      health?.session_ready === true &&
      health.can_send === true &&
      health.can_receive_runtime === true &&
      health.authenticated === true &&
      health?.activated === true &&
      health?.standby !== true &&
      (!health.worker_type_id || health.worker_type_id === workerType) &&
      health.kafka_unhealthy !== true &&
      !health.error &&
      Boolean(
        this.normalizeConnectionPhone(health.phone) ??
        this.normalizeConnectionPhone(phoneFallback)
      )
    );
  }

  private isRuntimeGenerationCompatible(
    payload: IBaileysConnectionState,
    health: IWorkerRuntimeHealthResponseProto | undefined
  ): boolean {
    const payloadGeneration = payload.runtime_generation;
    const healthGeneration = this.normalizeNotifyOptionalNumber(
      health?.runtime_generation
    );

    if (payloadGeneration === undefined || healthGeneration === undefined) {
      return true;
    }

    return payloadGeneration === healthGeneration;
  }

  private isStrictConnectedPayload(
    payload: Partial<IBaileysConnectionState>
  ): boolean {
    return (
      payload.session_ready === true &&
      payload.can_send === true &&
      payload.can_receive_runtime === true &&
      payload.authenticated === true &&
      Boolean(this.normalizeConnectionPhone(payload.phone))
    );
  }

  private normalizeConnectionPhone(
    phone: string | null | undefined
  ): string | undefined {
    const normalized = phone?.trim();
    return normalized ? normalized : undefined;
  }

  private async clearSelfHealRecoveryAfterNotification(
    payload: IBaileysConnectionState,
    workerStatusId: EWorkerStatus
  ): Promise<void> {
    const workerId = payload.worker_id;
    if (!workerId) {
      return;
    }

    if (
      workerStatusId === EWorkerStatus.online &&
      this.isStrictConnectedPayload(payload)
    ) {
      await this.redis.del(
        workerSelfHealRecoveryKey(workerId),
        workerSelfHealInflightKey(workerId)
      );
      this.logDebug('service.self_heal.recovery_cleared_healthy', {
        trace_id: payload.debug_trace_id,
        layer: 'service',
        worker_id: workerId,
        account_id: payload.account_id,
        worker_type_id: payload.worker_type_id,
        status: payload.status,
        worker_status_id: workerStatusId,
      });
      return;
    }

    if (
      workerStatusId === EWorkerStatus.offline &&
      payload.degraded_reason === 'self_heal_recovery_timeout'
    ) {
      const recoveryRaw = await this.redis.get(
        workerSelfHealRecoveryKey(workerId)
      );
      const recovery = parseWorkerSelfHealRecoveryState(recoveryRaw);
      await this.redis.del(
        workerSelfHealRecoveryKey(workerId),
        workerSelfHealInflightKey(workerId)
      );
      await this.redis.setex(
        workerSelfHealCooldownKey(workerId),
        this.selfHealCooldownSeconds,
        recovery?.operation_id ?? payload.debug_trace_id ?? 'timeout'
      );
    }
  }

  private async probeRecreatedWorkerRuntimeHealth(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): Promise<RecreateConnectionReconciliation | null> {
    try {
      const health = await this.workerBaileysGrpcClientService.runtimeHealth(
        data.worker_id,
        { worker_id: data.worker_id },
        workerType
      );
      const connected = this.isConnectedRuntimeHealth(health, workerType);

      if (!connected) {
        return null;
      }

      return {
        workerStatusId: EWorkerStatus.online,
        connectionState: {
          code: ECodeMessage.connectionEstablished,
          status: EBaileysConnectionStatus.connected,
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          phone: this.normalizeConnectionPhone(health?.phone),
          worker_status_id: EWorkerStatus.online,
          session_ready: true,
          can_send: health?.can_send,
          can_receive_runtime: health?.can_receive_runtime,
          authenticated: health?.authenticated,
          provider_state: health?.provider_state,
          degraded_reason: health?.degraded_reason,
          last_probe_at: health?.last_probe_at,
          probe_latency_ms: this.normalizeNotifyOptionalNumber(
            health?.probe_latency_ms
          ),
        },
      };
    } catch {
      return null;
    }
  }

  private async reconcileRecreatedWorkerConnection(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): Promise<RecreateConnectionReconciliation> {
    if (!this.shouldReconcileRecreatedWorkerConnection(data)) {
      return { workerStatusId: EWorkerStatus.disponible };
    }

    if (data.previous_worker_status_id !== EWorkerStatus.online) {
      const healthReconciliation = await this.probeRecreatedWorkerRuntimeHealth(
        data,
        workerType
      );

      if (healthReconciliation) {
        return healthReconciliation;
      }

      const hasPreviousWorkerStatus =
        data.previous_worker_status_id !== undefined &&
        data.previous_worker_status_id !== null;
      const delayedConnection = hasPreviousWorkerStatus
        ? await this.waitForRecreatedWorkerOnlineConfirmation(data, workerType)
        : null;

      if (delayedConnection) {
        return delayedConnection;
      }

      return { workerStatusId: EWorkerStatus.disponible };
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      debug_trace_id: data.debug_trace_id,
    };

    try {
      const response =
        await this.workerBaileysGrpcClientService.requestConnection(
          data.worker_id,
          payload,
          workerType
        );
      const connected = this.isConnectedConnectionState(response);

      if (!connected) {
        const delayedConnection =
          await this.waitForRecreatedWorkerOnlineConfirmation(data, workerType);

        if (delayedConnection) {
          return delayedConnection;
        }

        return { workerStatusId: EWorkerStatus.disponible };
      }

      const connectionState =
        await this.enrichRecreatedConnectionStateFromRuntimeHealth(
          data,
          workerType,
          {
            code: response?.code ?? ECodeMessage.connectionEstablished,
            status:
              response?.status === EBaileysConnectionStatus.connected
                ? response.status
                : EBaileysConnectionStatus.connected,
            worker_id: data.worker_id,
            account_id: data.account_id,
            phone: this.normalizeConnectionPhone(response?.phone),
            worker_status_id: EWorkerStatus.online,
            debug_trace_id: data.debug_trace_id,
            session_ready: true,
            can_send: response?.can_send,
            can_receive_runtime: response?.can_receive_runtime,
            authenticated: response?.authenticated,
            provider_state: response?.provider_state,
            degraded_reason: response?.degraded_reason,
            last_probe_at: response?.last_probe_at,
            probe_latency_ms: response?.probe_latency_ms,
          }
        );

      return {
        workerStatusId: EWorkerStatus.online,
        connectionState,
      };
    } catch {
      return { workerStatusId: EWorkerStatus.disponible };
    }
  }

  private async enrichRecreatedConnectionStateFromRuntimeHealth(
    data: IWorkerPayload,
    workerType: EWorkerType,
    connectionState: IBaileysConnectionState
  ): Promise<IBaileysConnectionState> {
    const healthReconciliation = await this.probeRecreatedWorkerRuntimeHealth(
      data,
      workerType
    );
    const healthState = healthReconciliation?.connectionState;
    const responsePhone = this.normalizeConnectionPhone(connectionState.phone);
    const healthPhone = this.normalizeConnectionPhone(healthState?.phone);

    if (!healthState) {
      return {
        ...connectionState,
        phone: responsePhone,
      };
    }

    return {
      ...connectionState,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id:
        connectionState.worker_type_id ?? healthState.worker_type_id,
      phone: healthPhone ?? responsePhone,
      worker_status_id: EWorkerStatus.online,
      debug_trace_id: connectionState.debug_trace_id ?? data.debug_trace_id,
      session_ready: true,
      can_send: healthState.can_send ?? connectionState.can_send,
      can_receive_runtime:
        healthState.can_receive_runtime ?? connectionState.can_receive_runtime,
      authenticated: healthState.authenticated ?? connectionState.authenticated,
      provider_state:
        healthState.provider_state ?? connectionState.provider_state,
      degraded_reason:
        healthState.degraded_reason ?? connectionState.degraded_reason,
      last_probe_at: healthState.last_probe_at ?? connectionState.last_probe_at,
      probe_latency_ms:
        healthState.probe_latency_ms ?? connectionState.probe_latency_ms,
    };
  }

  private async waitForRecreatedWorkerOnlineConfirmation(
    data: IWorkerPayload,
    workerType: EWorkerType
  ): Promise<RecreateConnectionReconciliation | null> {
    const deadline = Date.now() + this.recreateOnlineReconciliationWaitMs;

    while (Date.now() <= deadline) {
      const healthReconciliation = await this.probeRecreatedWorkerRuntimeHealth(
        data,
        workerType
      );

      if (healthReconciliation) {
        return healthReconciliation;
      }

      if (Date.now() > deadline) {
        break;
      }

      await this.sleep(this.recreateOnlineReconciliationPollIntervalMs);
    }

    return null;
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

    if (reconciliation.workerStatusId === EWorkerStatus.online) {
      inputUpdate.connection_date = currentTime();
      const phone = this.normalizeConnectionPhone(
        reconciliation.connectionState?.phone
      );
      if (phone) {
        inputUpdate.number = phone;
      }
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
      worker_type_id:
        data.worker_type_id ?? reconciliation.connectionState?.worker_type_id,
      phone: this.normalizeConnectionPhone(
        reconciliation.connectionState?.phone
      ),
      worker_status_id: EWorkerStatus.online,
      debug_trace_id:
        reconciliation.connectionState?.debug_trace_id ?? data.debug_trace_id,
      session_ready: true,
      can_send: reconciliation.connectionState?.can_send ?? true,
      can_receive_runtime:
        reconciliation.connectionState?.can_receive_runtime ?? true,
      authenticated: reconciliation.connectionState?.authenticated ?? true,
      provider_state: reconciliation.connectionState?.provider_state,
      degraded_reason: reconciliation.connectionState?.degraded_reason,
      last_probe_at: reconciliation.connectionState?.last_probe_at,
      probe_latency_ms: reconciliation.connectionState?.probe_latency_ms,
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

  private async resolveNextRuntimeGeneration(
    workerId: string
  ): Promise<number | undefined> {
    const runtime =
      await this.workerRuntimeRepository?.viewByWorkerId(workerId);
    return this.incrementRuntimeGeneration(runtime?.runtime_generation);
  }

  private incrementRuntimeGeneration(
    runtimeGeneration?: number | null
  ): number | undefined {
    if (!runtimeGeneration) {
      return undefined;
    }

    return runtimeGeneration + 1;
  }

  private async cleanupWorker(data: IWorkerPayload): Promise<void> {
    this.stopConnectionRequestRetry(data.worker_id);

    if (
      !(await this.isLifecycleOperationCurrent(data, {
        allowServerMismatch: true,
      }))
    ) {
      return;
    }

    const cleanupRemovesVolume = data.remove_volume !== false;
    if (data.remove_session === true && cleanupRemovesVolume) {
    } else if (data.remove_session === true) {
      const disconnectPayload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: EWorkerStatus.disponible,
        type: EBaileysConnectionType.qrcode,
        remove_session: true,
        debug_trace_id: data.debug_trace_id,
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
    this.logDebug('service.create_worker.start', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: data.worker_type_id,
      lifecycle_operation_id: data.lifecycle_operation_id,
    });
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
    if (!(await this.isLifecycleOperationCurrent(data))) {
      this.logDebug('service.create_worker.stale', {
        trace_id: data.debug_trace_id,
        layer: 'service',
        worker_id: data.worker_id,
        account_id: data.account_id,
        worker_type_id: data.worker_type_id,
        lifecycle_operation_id: data.lifecycle_operation_id,
        reason: 'lifecycle_operation_not_current',
      });
      return {} as PublishResult;
    }
    if (
      !data.lifecycle_operation_id &&
      !(await this.isWorkerSnapshotCurrent(
        data.worker_id,
        data.account_id,
        data.server_id,
        workerType
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
      debug_trace_id: data.debug_trace_id,
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
          createAttempt
        );
        this.logDebug('service.create_worker.container_created', {
          trace_id: data.debug_trace_id,
          layer: 'service',
          worker_id: data.worker_id,
          account_id: data.account_id,
          worker_type_id: workerType,
          lifecycle_operation_id: data.lifecycle_operation_id,
          container_id: containerId,
          attempt: createAttempt,
        });
        break;
      } catch (err) {
        lastError = err;
        const reason =
          err instanceof WorkerCreateAttemptError
            ? err.reason
            : 'create_attempt_failed';

        if (this.isStaleCreateAttemptReason(reason)) {
          return {} as PublishResult;
        }

        if (createAttempt < createMaxAttempts) {
          await this.prepareCreateWorkerRetry(data);
          continue;
        }

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
    await this.cleanupAssignedWarmPoolReferences(data.worker_id);
    this.logDebug('service.create_worker.available_published', {
      trace_id: data.debug_trace_id,
      layer: 'service',
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_type_id: workerType,
      lifecycle_operation_id: data.lifecycle_operation_id,
      container_id: containerId,
      status: EWorkerStatus.disponible,
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
        connection_attempt_id: connectionRequest.connection_attempt_id,
        debug_trace_id: connectionRequest.debug_trace_id ?? data.debug_trace_id,
        runtime_generation: connectionRequest.runtime_generation,
        warm_pool_id: connectionRequest.warm_pool_id,
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
    createAttempt: number
  ): Promise<string> {
    if (!(await this.isLifecycleOperationCurrent(data))) {
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
        workerType
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
      throw new WorkerCreateAttemptError(
        getErrorMessage(err),
        'create_health_failed',
        containerId
      );
    }

    if (!healthResult.healthy) {
      const reason = this.getCreateHealthFailureReason(healthResult);

      throw new WorkerCreateAttemptError(
        'Worker service is not healthy',
        reason,
        containerId,
        healthResult
      );
    }

    if (this.isWorkerGrpcReadinessRequired(workerType)) {
      try {
        await this.waitForWorkerGrpcReady(data.worker_id, workerType);
      } catch (err) {
        throw new WorkerCreateAttemptError(
          getErrorMessage(err),
          'create_grpc_readiness_failed',
          containerId,
          healthResult
        );
      }
    }

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

  private async prepareCreateWorkerRetry(data: IWorkerPayload): Promise<void> {
    try {
      await this.workerService.removeContainerWorker(data.worker_id, false);
    } catch {}
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
