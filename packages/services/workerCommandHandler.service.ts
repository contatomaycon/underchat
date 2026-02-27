import { injectable, inject } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';
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
import { ContainerHealthService } from '@core/services/containerHealth.service';
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
import { IPhoneValidationRequest } from '@core/common/interfaces/IPhoneValidationRequest';
import { IPhoneValidationResponse } from '@core/common/interfaces/IPhoneValidationResponse';
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

@injectable()
export class WorkerCommandHandlerService {
  private readonly maxRetries = 5;
  private readonly retryIntervalMs = 30 * 1000;
  private readonly connectionRequestRetryIntervalMs = 15_000;
  private readonly connectionRequestMinAttempts = 10;
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
    private readonly passwordEncryptorService: PasswordEncryptorService
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
      await this.createWorker(data);
      return;
    }

    if (data.action === EWorkerAction.delete) {
      try {
        await this.kafkaBaileysQueueService.delete(data.worker_id);
      } catch (err) {
        if (!this.isTopicOrPartitionMissing(err)) {
          throw err;
        }
      }
      await this.deleteWorker(data);
      return;
    }

    if (data.action === EWorkerAction.recreate) {
      try {
        await this.kafkaBaileysQueueService.delete(data.worker_id);
      } catch {}
      await this.recreateWorker(data);
    }
  }

  async handleChangeConnectionStatus(
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

    if (payload.status === EWorkerStatus.online) {
      const ensured = await this.ensureContainerAndRequestConnection(
        payload,
        accountId
      );
      if (ensured) {
        return;
      }
      this.startConnectionRequestRetry(payload);
      return;
    }

    this.stopConnectionRequestRetry(payload.worker_id);
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
      if (!this.isTopicOrPartitionMissing(err)) {
        throw err;
      }
    }
  }

  async notifyWorkerStatus(
    input: INotifyWorkerStatusRequestProto
  ): Promise<void> {
    const workerId = input.worker_id;
    const accountId = input.account_id;
    const workerStatusId = input.worker_status_id as EWorkerStatus | undefined;

    if (!workerId || !accountId || !workerStatusId) {
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

  private async ensureContainerAndRequestConnection(
    payload: StatusConnectionWorkerRequest,
    accountId?: string
  ): Promise<boolean> {
    const workerId = payload.worker_id;
    const workerData = await this.resolveWorkerDataForContainer(
      workerId,
      accountId
    );
    if (!workerData) {
      return false;
    }

    const existsContainer =
      await this.workerService.existsContainerWorkerById(workerId);
    if (existsContainer) {
      const healthy = await this.containerHealthService.isServiceHealthy(
        workerId,
        {
          maxAttempts: 3,
          delayMs: 1000,
        }
      );
      if (healthy) {
        return false;
      }
    }

    await this.createWorkerWithPayload(workerId, workerData, payload);
    return true;
  }

  private async resolveWorkerDataForContainer(
    workerId: string,
    accountId?: string
  ): Promise<{
    accountIdResolved: string;
    serverId: string;
    workerTypeId: EWorkerType;
  } | null> {
    if (accountId) {
      const fromView = await this.resolveWorkerDataFromView(
        accountId,
        workerId
      );
      if (fromView) {
        return fromView;
      }
    }

    return this.resolveWorkerDataFromMonitor(workerId);
  }

  private async resolveWorkerDataFromView(
    accountId: string,
    workerId: string
  ): Promise<{
    accountIdResolved: string;
    serverId: string;
    workerTypeId: EWorkerType;
  } | null> {
    const view = await this.workerService.viewWorker(accountId, workerId);
    if (!view?.server?.id || !view?.type?.id) {
      return null;
    }

    return {
      accountIdResolved: accountId,
      serverId: view.server.id,
      workerTypeId: view.type.id as EWorkerType,
    };
  }

  private async resolveWorkerDataFromMonitor(workerId: string): Promise<{
    accountIdResolved: string;
    serverId: string;
    workerTypeId: EWorkerType;
  } | null> {
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
    };
  }

  private async createWorkerWithPayload(
    workerId: string,
    workerData: {
      accountIdResolved: string;
      serverId: string;
      workerTypeId: EWorkerType;
    },
    connectionRequest?: StatusConnectionWorkerRequest
  ): Promise<void> {
    const createPayload: IWorkerPayload = {
      action: EWorkerAction.create,
      worker_id: workerId,
      server_id: workerData.serverId,
      account_id: workerData.accountIdResolved,
      worker_type_id: workerData.workerTypeId,
    };

    await this.createWorker(createPayload, connectionRequest);
  }

  private startConnectionRequestRetry(
    payload: StatusConnectionWorkerRequest
  ): void {
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

    const workerType = await this.resolveWorkerTypeForConnection(workerId);

    this.workerBaileysGrpcClientService
      .requestConnection(workerId, payload, workerType)
      .then(() => {
        this.stopConnectionRequestRetry(workerId);
      })
      .catch((err) => {
        console.error('Failed to request worker connection:', err);

        if (attempt < this.connectionRequestMinAttempts) {
          this.scheduleNextConnectionRequest(workerId);
          return;
        }

        this.scheduleNextConnectionRequest(workerId);
      });
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
  ): Promise<
    | {
        protocol: EProxyProtocol;
        host: string;
        port: number;
        username?: string | null;
        password?: string | null;
      }
    | undefined
  > {
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

  private centrifugoPublish(
    dataPublish: IBaileysConnectionState
  ): Promise<PublishResult> {
    const channel = workerCentrifugoQueue(dataPublish.account_id);
    return this.centrifugoService.publishSub(channel, dataPublish);
  }

  private async updateWorkerErrorStatus(
    workerId: string,
    accountId: string,
    action?: EWorkerAction,
    serverId?: string
  ): Promise<PublishResult> {
    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.error,
    };

    await this.workerService.updateWorkerById(accountId, inputUpdate);

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
    const viewWorkerType = await this.workerService.viewWorkerType(
      data.account_id,
      data.worker_id
    );

    if (!viewWorkerType) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker not found');
    }

    const removed = await this.retryOperation(
      async () =>
        this.workerService.removeContainerWorker(data.worker_id, false),
      (r) => !r
    );

    if (!removed) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker removal failed');
    }

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
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

    const containerId = await this.retryOperation(
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          false,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy
        ),
      (r) => !r
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker creation failed');
    }

    const wasOnline = data.previous_worker_status_id === EWorkerStatus.online;

    const healthy = await this.retryOperation(
      async () => {
        if (wasOnline) {
          const serviceOk = await this.containerHealthService.isServiceHealthy(
            containerId,
            { maxAttempts: 5, delayMs: 2000 }
          );
          if (!serviceOk) return false;
          return this.containerHealthService.isConnectionHealthy(containerId, {
            maxAttempts: 10,
            delayMs: 10000,
          });
        }
        return this.containerHealthService.isServiceHealthy(containerId);
      },
      (r) => !r
    );

    if (!healthy) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error(
        wasOnline
          ? 'Worker service or connection health check failed'
          : 'Worker service is not healthy'
      );
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: workerType,
      container_id: containerId,
    };

    const updated = await this.retryOperation(
      async () =>
        this.workerService.updateWorkerById(data.account_id, inputUpdate),
      (r) => !r
    );

    if (!updated) {
      console.error('Failed to update worker status after recreate', {
        workerId: data.worker_id,
        accountId: data.account_id,
        action: data.action,
      });
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.recreating,
      type: EBaileysConnectionType.qrcode,
    };

    try {
      await this.workerBaileysGrpcClientService.requestConnection(
        data.worker_id,
        payload,
        data.worker_type_id as EWorkerType
      );
    } catch (err) {
      if (!this.isTopicOrPartitionMissing(err)) {
        console.error('Failed to request worker connection after recreate', {
          workerId: data.worker_id,
          accountId: data.account_id,
          workerTypeId: data.worker_type_id,
          error: getErrorMessage(err),
        });
      }
    }

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
    connectionRequest?: StatusConnectionWorkerRequest
  ): Promise<PublishResult> {
    if (!data?.worker_type_id) {
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);
      throw new Error('Worker type ID is required');
    }

    const inputUpdateCreating: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.creating,
    };

    await this.workerService.updateWorkerById(
      data.account_id,
      inputUpdateCreating
    );

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

    const imageName = getImageWorker(data.worker_type_id);

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

    const containerId = await this.retryOperation(
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          true,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort,
          proxy
        ),
      (r) => !r
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);
      throw new Error('Failed to create worker container');
    }

    const healthy = await this.containerHealthService.isServiceHealthy(
      containerId,
      {
        maxAttempts: 30,
        delayMs: 2000,
      }
    );

    if (!healthy) {
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);
      throw new Error('Worker service is not healthy');
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
    };

    const updated = await this.retryOperation(
      async () =>
        this.workerService.updateWorkerById(data.account_id, inputUpdate),
      (r) => !r
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
      (data.worker_type_id === EWorkerType.baileys ||
        data.worker_type_id === EWorkerType.wwebjs)
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

      void this.workerBaileysGrpcClientService
        .requestConnection(
          data.worker_id,
          payload,
          data.worker_type_id as EWorkerType
        )
        .catch((err) => {
          if (!this.isTopicOrPartitionMissing(err)) {
            console.error('Failed to request worker connection:', err);
          }
        });
    }

    return {} as PublishResult;
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
