import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { WorkerService } from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';
import { KafkaBalanceQueueService } from '@core/services/kafkaBalanceQueue.service';
import { balanceEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { ContainerHealthService } from '@core/services/containerHealth.service';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { workerCentrifugoQueue } from '@core/common/functions/centrifugoQueue';

@singleton()
export class WorkerConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly containerHealthService: ContainerHealthService,
    private readonly streamProducerService: StreamProducerService
  ) {}

  private centrifugoPublish(
    dataPublish: IBaileysConnectionState
  ): Promise<PublishResult> {
    return this.centrifugoService.publishSub(
      workerCentrifugoQueue(dataPublish.account_id),
      dataPublish
    );
  }

  private async updateWorkerErrorStatus(
    workerId: string,
    accountId: string,
    isAdministrator: boolean
  ): Promise<PublishResult> {
    const inputUpdate: IUpdateWorker = {
      worker_id: workerId,
      worker_status_id: EWorkerStatus.error,
    };

    await this.workerService.updateWorkerById(
      isAdministrator,
      accountId,
      inputUpdate
    );

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: workerId,
      account_id: accountId,
      worker_status_id: EWorkerStatus.error,
    };

    return this.centrifugoPublish(dataPublish);
  }

  private async recreateWorker(data: IWorkerPayload): Promise<PublishResult> {
    const viewWorkerType = await this.workerService.viewWorkerType(
      data.account_id,
      data.is_administrator,
      data.worker_id
    );

    if (!viewWorkerType) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker not found');
    }

    const removeContainerWorker =
      await this.workerService.removeContainerWorker(data.worker_id, false);

    if (!removeContainerWorker) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker removal failed');
    }

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
    const imageName = getImageWorker(workerType);

    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id,
      data.account_id,
      false
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker creation failed');
    }

    const healthy =
      await this.containerHealthService.isServiceHealthy(containerId);

    if (!healthy) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker service is not healthy');
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      worker_type_id: workerType,
      container_id: containerId,
    };

    const updateWorkerById = await this.workerService.updateWorkerById(
      data.is_administrator,
      data.account_id,
      inputUpdate
    );

    if (!updateWorkerById) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Failed to update worker status');
    }

    const payload: StatusConnectionWorkerRequest = {
      worker_id: data.worker_id,
      status: EWorkerStatus.recreating,
      type: data.worker_type_id as EWorkerType,
    };

    await this.streamProducerService.send(
      this.kafkaBaileysQueueService.workerConnection(data.worker_id),
      payload,
      data.worker_id
    );

    const dataPublish: IBaileysConnectionState = {
      code: ECodeMessage.info,
      status: EBaileysConnectionStatus.info,
      worker_id: data.worker_id,
      account_id: data.account_id,
      worker_status_id: EWorkerStatus.disponible,
    };

    return this.centrifugoPublish(dataPublish);
  }

  private async deleteWorker(data: IWorkerPayload): Promise<PublishResult> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      data.is_administrator,
      data.account_id,
      data.worker_id
    );

    if (!existsWorkerById) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker not found');
    }

    const containerId = await this.workerService.removeContainerWorker(
      data.worker_id
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker removal failed');
    }

    const deleteWorkerById = await this.workerService.deleteWorkerById(
      data.is_administrator,
      data.account_id,
      data.worker_id
    );

    if (!deleteWorkerById) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
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

    return this.centrifugoPublish(dataPublish);
  }

  private async createWorker(data: IWorkerPayload): Promise<PublishResult> {
    if (!data?.worker_type_id) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker type ID is required');
    }

    const imageName = getImageWorker(data.worker_type_id);

    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id,
      data.account_id
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Failed to create worker container');
    }

    const healthy =
      await this.containerHealthService.isServiceHealthy(containerId);

    if (!healthy) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
      throw new Error('Worker service is not healthy');
    }

    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.disponible,
      container_id: containerId,
    };

    const updateWorkerById = await this.workerService.updateWorkerById(
      data.is_administrator,
      data.account_id,
      inputUpdate
    );

    if (!updateWorkerById) {
      await this.updateWorkerErrorStatus(
        data.worker_id,
        data.account_id,
        data.is_administrator
      );
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

  private parseMessage(value: Buffer | null): IWorkerPayload | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IWorkerPayload;
    } catch {
      return null;
    }
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    const topic = this.kafkaBalanceQueueService.worker(
      balanceEnvironment.serverId
    );

    this.consumer = this.kafka.consumer({
      groupId: `group-underchat-worker-${balanceEnvironment.serverId}`,
      retry: { retries: 8, initialRetryTime: 300 },
      allowAutoTopicCreation: true,
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);
        if (!data) return;

        if (data.action === EWorkerAction.create) {
          await this.createWorker(data);
          return;
        }

        if (data.action === EWorkerAction.delete) {
          await this.kafkaBaileysQueueService.delete(data.worker_id);
          await this.deleteWorker(data);
          return;
        }

        if (data.action === EWorkerAction.recreate) {
          await this.kafkaBaileysQueueService.delete(data.worker_id);
          await this.recreateWorker(data);
          return;
        }
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;
    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}
