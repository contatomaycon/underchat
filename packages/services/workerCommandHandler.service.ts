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
import { StreamProducerService } from '@core/services/streamProducer.service';
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

@injectable()
export class WorkerCommandHandlerService {
  private readonly maxRetries = 5;
  private readonly retryIntervalMs = 30 * 1000;

  constructor(
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly containerHealthService: ContainerHealthService,
    private readonly streamProducerService: StreamProducerService
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
    input: StatusConnectionWorkerRequest
  ): Promise<void> {
    const payload: StatusConnectionWorkerRequest = {
      worker_id: input.worker_id,
      status: input.status,
      type: input.type,
      phone_connection: input.phone_connection,
    };

    await this.streamProducerService.send(
      this.kafkaBaileysQueueService.workerConnection(input.worker_id),
      payload,
      input.worker_id
    );
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
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Failed to update worker status');
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.recreating,
      type: data.worker_type_id as EWorkerType,
    };

    try {
      await this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerConnection(data.worker_id),
        payload,
        data.worker_id
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

    const [result] = await Promise.all([
      this.centrifugoPublish(dataPublish),
      this.centrifugoService.publish(channelsConfigCentrifugo(), data),
    ]);
    return result;
  }

  private async deleteWorker(data: IWorkerPayload): Promise<PublishResult> {
    const exists = await this.workerService.existsWorkerById(
      data.account_id,
      data.worker_id
    );

    if (!exists) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker not found');
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      number: null,
      container_id: null,
      connection_date: null,
    };

    const updated = await this.retryOperation(
      async () =>
        this.workerService.updateWorkerById(data.account_id, inputUpdate),
      (r) => !r
    );

    if (!updated) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Failed to update worker status');
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.disponible,
      type: EBaileysConnectionType.qrcode,
    };

    try {
      await this.streamProducerService.send(
        this.kafkaBaileysQueueService.workerConnection(data.worker_id),
        payload,
        data.worker_id
      );
    } catch (err) {
      if (!this.isTopicOrPartitionMissing(err)) {
        throw err;
      }
    }

    const containerId = await this.retryOperation(
      async () => this.workerService.removeContainerWorker(data.worker_id),
      (r) => !r
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.action,
        data.server_id
      );
      throw new Error('Worker removal failed');
    }

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

  private async createWorker(data: IWorkerPayload): Promise<PublishResult> {
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

    await this.centrifugoPublish(dataPublishCreating);

    const imageName = getImageWorker(data.worker_type_id);

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

    const healthy = await this.retryOperation(
      async () =>
        this.containerHealthService.isServiceHealthy(containerId, {
          maxAttempts: 5,
          delayMs: 2000,
        }),
      (r) => !r
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
      await this.updateWorkerErrorStatus(data.worker_id, data.account_id);
      throw new Error('Failed to update worker status');
    }

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    return this.centrifugoPublish(dataPublish);
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
