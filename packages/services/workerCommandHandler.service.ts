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
import { WorkerLifecycleLockService } from '@core/services/workerLifecycleLock.service';

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
    private readonly redis: Redis
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

    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: EWorkerStatus.online,
      type: EBaileysConnectionType.qrcode,
      connection_attempt_id: input.connection_attempt_id ?? uuidv7(),
    };

    this.stopConnectionRequestRetry(payload.worker_id);
    this.stopQrConnectionAttemptRetry(payload.worker_id);
    return this.runWithWorkerLifecycleLock(
      payload.worker_id,
      'request_qrcode',
      () => this.runConnectionQrCodeWorkflow(payload, accountId)
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
      has_phone: Boolean(input.phone),
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
      });
      throw new Error(
        'Missing required fields: worker_id, account_id, worker_status_id'
      );
    }

    const isDisponibleWithDisconnectedUser =
      workerStatusId === EWorkerStatus.disponible &&
      input.disconnected_user === true;

    const payload: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: workerStatusId,
      phone: input.phone ?? undefined,
      disconnected_user: input.disconnected_user ?? undefined,
    };

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
      });
      return;
    }

    const view =
      await this.workerService.viewWorkerPhoneConnectionDate(workerId);

    const inputPhone = input.phone?.trim() || null;
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

    await Promise.all([
      this.centrifugoPublish(payload),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]);
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.notify_status_success',
      decision: 'notify_worker_status',
      outcome: 'success',
      worker_status_id: workerStatusId,
      has_phone: Boolean(phoneNumber),
    });
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
    } = {}
  ): IBaileysConnectionState {
    return {
      code: ECodeMessage.awaitingReadQrCode,
      status: EBaileysConnectionStatus.connecting,
      worker_id: payload.worker_id,
      account_id: accountId,
      connection_attempt_id: this.ensureQrConnectionAttemptId(payload),
      qr_pending: true,
      ...(options.attempt !== undefined ? { attempt: options.attempt } : {}),
      ...(options.maxAttempts !== undefined
        ? { max_attempts: options.maxAttempts }
        : {}),
    };
  }

  private normalizeQrWorkerResponse(
    response: IBaileysConnectionState,
    payload: StatusConnectionWorkerRequest,
    accountId: string
  ): IBaileysConnectionState {
    const normalized: IBaileysConnectionState = {
      ...response,
      worker_id: response.worker_id || payload.worker_id,
      account_id: response.account_id || accountId,
      connection_attempt_id:
        response.connection_attempt_id ??
        this.ensureQrConnectionAttemptId(payload),
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
      normalized.code = ECodeMessage.awaitingReadQrCode;
      normalized.status = EBaileysConnectionStatus.connecting;
    }

    return normalized;
  }

  private async cacheQrAttemptState(
    state: IBaileysConnectionState
  ): Promise<void> {
    await this.redis.setex(
      this.qrAttemptCacheKey(state.worker_id),
      this.qrAttemptTtlSeconds,
      JSON.stringify(state)
    );
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
      level?: 'info' | 'warn' | 'error';
    }
  ): Promise<void> {
    try {
      await this.cacheQrAttemptState(state);
    } catch (err) {
      recordConnectionQrSummary({
        event: 'balancer_qrcode_cache_error',
        ...summarizeConnectionQrState(state),
        worker_type: options.workerType,
        reason: 'redis_cache_failed',
        error: getErrorMessage(err),
        level: 'error',
      });
    }

    recordConnectionQrSummary({
      event: options.event,
      ...summarizeConnectionQrState(state),
      worker_type: options.workerType,
      reason: options.reason,
      error: options.error,
      recreate_reason: options.recreateReason,
      time_to_first_qr_ms: options.timeToFirstQrMs,
      level: options.level,
    });

    if (state.account_id) {
      try {
        await this.centrifugoPublish(state);
      } catch (err) {
        recordConnectionQrSummary({
          event: 'balancer_qrcode_publish_error',
          ...summarizeConnectionQrState(state),
          worker_type: options.workerType,
          reason: 'centrifugo_publish_failed',
          error: getErrorMessage(err),
          level: 'error',
        });
      }
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
    this.stopQrConnectionAttemptRetry(payload.worker_id);
    this.qrConnectionRequestPayloads.set(payload.worker_id, {
      payload: { ...payload },
      accountId,
      workerData,
      startedAtMs: Date.now(),
    });
    this.qrConnectionRequestAttempts.set(payload.worker_id, 0);
    this.scheduleNextQrConnectionAttempt(payload.worker_id);
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
        }
      );
      await this.cacheAndPublishQrAttemptState(pending, {
        event: 'balancer_qrcode_retry_exhausted',
        workerType: context.workerData.workerTypeId,
        reason: 'retry_exhausted',
        level: 'warn',
      });
      this.stopQrConnectionAttemptRetry(workerId);
      return;
    }

    try {
      await this.runWithWorkerLifecycleLock(
        workerId,
        'request_qrcode_retry',
        async () => {
          await this.ensureQrContainerReady(workerId, context.workerData);

          if (context.workerData.lifecycleOperationId) {
            const current = await this.isLifecycleOperationCurrent(
              {
                action: EWorkerAction.create,
                worker_id: workerId,
                server_id: context.workerData.serverId,
                account_id: context.workerData.accountIdResolved,
                worker_type_id: context.workerData.workerTypeId,
                lifecycle_operation_id: context.workerData.lifecycleOperationId,
              },
              'request_qrcode_retry_before_worker_request'
            );

            if (!current) {
              throw new Error('Worker lifecycle changed before QR retry');
            }
          } else if (
            !(await this.isWorkerSnapshotCurrent(
              workerId,
              context.workerData.accountIdResolved,
              context.workerData.serverId,
              context.workerData.workerTypeId,
              'request_qrcode_retry_before_worker_request'
            ))
          ) {
            throw new Error('Worker snapshot changed before QR retry');
          }

          const response =
            await this.workerBaileysGrpcClientService.requestConnectionQrCode(
              workerId,
              context.payload,
              context.workerData.workerTypeId
            );
          const normalized = this.normalizeQrWorkerResponse(
            response,
            context.payload,
            context.accountId
          );
          normalized.attempt ??= attempt;
          normalized.max_attempts ??= this.qrRetryMaxAttempts;

          await this.cacheAndPublishQrAttemptState(normalized, {
            event: normalized.qrcode
              ? 'balancer_qrcode_retry_success'
              : 'balancer_qrcode_retry_pending',
            workerType: context.workerData.workerTypeId,
            reason: normalized.qrcode
              ? undefined
              : 'worker_response_without_qr',
            timeToFirstQrMs: normalized.qrcode
              ? Date.now() - context.startedAtMs
              : undefined,
            level: normalized.qrcode ? 'info' : 'warn',
          });

          if (normalized.qrcode) {
            this.stopQrConnectionAttemptRetry(workerId);
          }
        }
      );
    } catch (err) {
      const retryable = this.isRetryableQrRequestError(err);
      const pending = this.buildQrPendingState(
        context.payload,
        context.accountId,
        {
          attempt,
          maxAttempts: this.qrRetryMaxAttempts,
        }
      );
      await this.cacheAndPublishQrAttemptState(pending, {
        event: retryable
          ? 'balancer_qrcode_retry_error_pending'
          : 'balancer_qrcode_retry_error_stopped',
        workerType: context.workerData.workerTypeId,
        reason: retryable
          ? 'retryable_worker_error'
          : 'non_retryable_worker_error',
        error: getErrorMessage(err),
        level: retryable ? 'warn' : 'error',
      });

      if (!retryable) {
        this.stopQrConnectionAttemptRetry(workerId);
        return;
      }
    }

    if (this.qrConnectionRequestPayloads.has(workerId)) {
      this.scheduleNextQrConnectionAttempt(workerId);
    }
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

    await this.ensureQrContainerReady(workerId, workerData);

    if (workerData.lifecycleOperationId) {
      const current = await this.isLifecycleOperationCurrent(
        {
          action: EWorkerAction.create,
          worker_id: workerId,
          server_id: workerData.serverId,
          account_id: workerData.accountIdResolved,
          worker_type_id: workerData.workerTypeId,
          lifecycle_operation_id: workerData.lifecycleOperationId,
        },
        'request_qrcode_before_worker_request'
      );

      if (!current) {
        throw new Error('Worker lifecycle changed before QR request');
      }
    } else if (
      !(await this.isWorkerSnapshotCurrent(
        workerId,
        workerData.accountIdResolved,
        workerData.serverId,
        workerData.workerTypeId,
        'request_qrcode_before_worker_request'
      ))
    ) {
      throw new Error('Worker snapshot changed before QR request');
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_worker_request_start',
      decision: 'request_worker_qrcode',
      outcome: 'started',
      worker_type: workerData.workerTypeId,
      status: payload.status,
      connection_type: payload.type,
      connection_attempt_id: payload.connection_attempt_id,
    });

    let response: IBaileysConnectionState;
    try {
      response =
        await this.workerBaileysGrpcClientService.requestConnectionQrCode(
          workerId,
          payload,
          workerData.workerTypeId
        );
    } catch (err) {
      if (!this.isRetryableQrRequestError(err)) {
        recordConnectionQrSummary({
          event: 'balancer_qrcode_initial_error',
          worker_id: workerId,
          account_id: workerData.accountIdResolved,
          connection_attempt_id: payload.connection_attempt_id,
          worker_type: workerData.workerTypeId,
          status: payload.status,
          reason: 'non_retryable_worker_error',
          error: getErrorMessage(err),
          level: 'error',
        });
        throw err;
      }

      const pending = this.buildQrPendingState(
        payload,
        workerData.accountIdResolved
      );
      await this.cacheAndPublishQrAttemptState(pending, {
        event: 'balancer_qrcode_initial_error_pending',
        workerType: workerData.workerTypeId,
        reason: 'retryable_worker_error',
        error: getErrorMessage(err),
        level: 'warn',
      });
      this.startQrConnectionAttemptRetry(
        payload,
        workerData.accountIdResolved,
        workerData
      );
      return pending;
    }

    const normalized = this.normalizeQrWorkerResponse(
      response,
      payload,
      workerData.accountIdResolved
    );
    recordConnectionLifecycle({
      stage: 'connection.balancer.command_handler.qrcode_new_worker_success',
      decision: 'request_worker_qrcode',
      outcome: 'success',
      worker_type: workerData.workerTypeId,
      status: normalized.status,
      code: normalized.code,
      qrcode: normalized.qrcode,
      pairing_code: normalized.pairing_code,
      has_qr: Boolean(normalized.qrcode),
      has_pairing_code: Boolean(normalized.pairing_code),
      qr_pending: normalized.qr_pending === true,
      connection_attempt_id: normalized.connection_attempt_id,
    });

    await this.cacheAndPublishQrAttemptState(normalized, {
      event: normalized.qrcode
        ? 'balancer_qrcode_initial_success'
        : 'balancer_qrcode_initial_pending',
      workerType: workerData.workerTypeId,
      reason: normalized.qrcode ? undefined : 'worker_response_without_qr',
      timeToFirstQrMs: normalized.qrcode ? 0 : undefined,
      level: normalized.qrcode ? 'info' : 'warn',
    });

    if (!normalized.qrcode && normalized.qr_pending === true) {
      this.startQrConnectionAttemptRetry(
        payload,
        workerData.accountIdResolved,
        workerData
      );
    }

    return normalized;
  }

  private async ensureQrContainerReady(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer
  ): Promise<void> {
    if (
      workerData.workerStatusId === EWorkerStatus.creating ||
      workerData.workerStatusId === EWorkerStatus.recreating
    ) {
      const ready = await this.waitForExistingQrContainerReady(
        workerId,
        workerData,
        { maxAttempts: 10, delayMs: 2000, grpcReadyTimeoutMs: 2000 }
      );
      if (ready) {
        return;
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
            return;
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
          recreateReason = 'existing_container_health_failed';
        }
      }
    }

    if (inspection.exists) {
      await this.recordContainerDiagnosticsSafely(workerId, recreateReason);
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

    await this.createWorkerWithPayload(workerId, workerData, undefined, {
      maxAttempts: 30,
      delayMs: 1000,
      requiredConsecutiveSuccesses: 3,
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
    if (accountId) {
      const fromView = await this.resolveWorkerDataFromView(
        accountId,
        workerId
      );
      if (fromView) {
        const fromMonitor = await this.resolveWorkerDataFromMonitor(workerId);
        return {
          ...fromView,
          containerId: fromMonitor?.containerId,
          lifecycleOperationId: fromMonitor?.lifecycleOperationId,
        };
      }
    }

    return this.resolveWorkerDataFromMonitor(workerId);
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

  private async createWorkerWithPayload(
    workerId: string,
    workerData: ResolvedWorkerDataForContainer,
    connectionRequest?: StatusConnectionWorkerRequest,
    healthOptions?: ContainerHealthCheckOptions
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

    await this.createWorker(createPayload, connectionRequest, healthOptions);
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
    recordConnectionLifecycle({
      stage: 'connection.balancer.centrifugo.publish_start',
      decision: 'publish_connection_state',
      outcome: 'started',
      centrifugo_channel: channel,
      status: dataPublish.status,
      code: dataPublish.code,
      worker_status_id: dataPublish.worker_status_id,
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

    if (
      !(await this.isLifecycleOperationCurrent(
        data,
        'recreate_worker_before_remove'
      ))
    ) {
      return {} as PublishResult;
    }

    if (shouldRemoveSession) {
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

    const removed = await this.retryOperation(
      async () =>
        this.workerService.removeContainerWorker(
          data.worker_id,
          shouldRemoveVolume
        ),
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
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          false,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy,
          {
            workerTypeId: workerType,
            workerGrpcPort: this.getExpectedWorkerGrpcPort(workerType),
          }
        ),
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

  private async cleanupWorker(data: IWorkerPayload): Promise<void> {
    this.stopConnectionRequestRetry(data.worker_id);

    if (
      !(await this.isLifecycleOperationCurrent(data, 'cleanup_worker', {
        allowServerMismatch: true,
      }))
    ) {
      return;
    }

    if (data.remove_session === true) {
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
        this.workerService.cleanupContainerWorker(
          data.worker_id,
          data.remove_volume !== false
        ),
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

    const payload: StatusConnectionWorkerRequest = {
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
        payload,
        workerType
      );
    } catch (err) {
      if (!this.isTopicOrPartitionMissing(err)) {
        console.error('Failed to request worker disconnect before delete', {
          workerId: data.worker_id,
          accountId: data.account_id,
          error: getErrorMessage(err),
        });
      }
    }

    let containerRemoved = false;
    try {
      containerRemoved = await this.retryOperation(
        async () => this.workerService.removeContainerWorker(data.worker_id),
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
    healthOptions: ContainerHealthCheckOptions = {}
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
    const resolvedHealthOptions =
      this.buildNewContainerHealthOptions(healthOptions);

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

    const proxy = await this.resolveWorkerProxyConfig(
      data.worker_id,
      data.server_id
    );

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
