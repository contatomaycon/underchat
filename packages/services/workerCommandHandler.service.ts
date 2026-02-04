import { injectable } from 'tsyringe';
import { WorkerService } from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
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

  constructor(
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly containerHealthService: ContainerHealthService,
    private readonly workerBaileysGrpcClientService: WorkerBaileysGrpcClientService
  ) {}

  private isTopicOrPartitionMissing(err: unknown): boolean {
    const msg = getErrorMessage(err).toLowerCase();
    return (
      msg.includes('unknown partition') ||
      msg.includes('unknown topic') ||
      msg.includes('topic or partition')
    );
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
      await this.workerBaileysGrpcClientService.requestConnection(
        input.worker_id,
        payload
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
      return;
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

    const phoneNumber = input.phone ?? view?.number ?? null;

    await this.workerService.updateWorkerPhoneStatusConnectionDate({
      worker_id: workerId,
      status: workerStatusId,
      number: phoneNumber,
      connection_date: view?.connection_date,
    });
    await Promise.all([
      this.centrifugoPublish(payload),
      this.centrifugoService.publish(channelsConfigCentrifugo(), payload),
    ]);
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
    this.runConnectionRequestAttempt(payload.worker_id);
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
      this.runConnectionRequestAttempt(workerId);
    }, this.connectionRequestRetryIntervalMs);
    this.connectionRequestTimers.set(workerId, timer);
  }

  private runConnectionRequestAttempt(workerId: string): void {
    const payload = this.connectionRequestPayloads.get(workerId);
    if (!payload) {
      return;
    }

    const attempt = (this.connectionRequestAttempts.get(workerId) ?? 0) + 1;
    this.connectionRequestAttempts.set(workerId, attempt);

    this.workerBaileysGrpcClientService
      .requestConnection(workerId, payload)
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

    const containerId = await this.retryOperation(
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          false,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort
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
      type: data.worker_type_id as EWorkerType,
    };

    try {
      await this.workerBaileysGrpcClientService.requestConnection(
        data.worker_id,
        payload
      );
    } catch (err) {
      if (!this.isTopicOrPartitionMissing(err)) {
        throw err;
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
    };

    try {
      await this.workerBaileysGrpcClientService.requestConnection(
        data.worker_id,
        payload
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

    const containerId = await this.retryOperation(
      async () =>
        this.workerService.createContainerWorker(
          imageName,
          data.worker_id,
          data.account_id,
          true,
          balanceEnvironment.grpcHost,
          balanceEnvironment.grpcPort
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

    if (data.worker_type_id === EWorkerType.baileys) {
      const payload: StatusConnectionWorkerRequest = {
        worker_id: data.worker_id,
        status: connectionRequest?.status ?? EWorkerStatus.online,
        type: connectionRequest?.type ?? EBaileysConnectionType.qrcode,
        ...(connectionRequest?.phone_connection
          ? { phone_connection: connectionRequest.phone_connection }
          : {}),
      };

      void this.workerBaileysGrpcClientService
        .requestConnection(data.worker_id, payload)
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
