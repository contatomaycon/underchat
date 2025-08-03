import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { WorkerService } from '@core/services/worker.service';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { balanceEnvironment } from '@core/config/environments';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { IWorkerPayload } from '@core/common/interfaces/IWorkerPayload';
import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PublishResult } from 'centrifuge';

@injectable()
export class WorkerConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private topic = `worker.${balanceEnvironment.serverId}`;

  private async updateWorkerErrorStatus(
    data: IWorkerPayload
  ): Promise<PublishResult> {
    const inputUpdate: IUpdateWorker = {
      worker_id: data.worker_id,
      worker_status_id: EWorkerStatus.error,
    };

    data.worker_status_id = EWorkerStatus.error;

    await this.workerService.updateWorkerById(
      data.is_administrator,
      data.account_id,
      inputUpdate
    );

    return this.centrifugoService.publish(this.topic, data);
  }

  private async recreateWorker(data: IWorkerPayload): Promise<void> {
    const viewWorkerType = await this.workerService.viewWorkerType(
      data.account_id,
      data.is_administrator,
      data.worker_id
    );

    if (!viewWorkerType) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker not found');
    }

    const removeContainerWorker =
      await this.workerService.removeContainerWorker(data.worker_id, false);

    if (!removeContainerWorker) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker removal failed');
    }

    const workerType = viewWorkerType.worker_type_id as EWorkerType;
    const imageName = getImageWorker(workerType);

    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id,
      false
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker creation failed');
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
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to update worker status');
    }

    await this.centrifugoService.publish(this.topic, data);
  }

  private async deleteWorker(data: IWorkerPayload): Promise<void> {
    const existsWorkerById = await this.workerService.existsWorkerById(
      data.is_administrator,
      data.account_id,
      data.worker_id
    );

    if (!existsWorkerById) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker not found');
    }

    const containerId = await this.workerService.removeContainerWorker(
      data.worker_id
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker removal failed');
    }

    const deleteWorkerById = await this.workerService.deleteWorkerById(
      data.is_administrator,
      data.account_id,
      data.worker_id
    );

    if (!deleteWorkerById) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to delete worker');
    }

    await this.centrifugoService.publish(this.topic, data);
  }

  private async createWorker(data: IWorkerPayload): Promise<void> {
    if (!data?.worker_type_id) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Worker type ID is required');
    }

    const imageName = getImageWorker(data.worker_type_id);

    const containerId = await this.workerService.createContainerWorker(
      imageName,
      data.worker_id
    );

    if (!containerId) {
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to create worker container');
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
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to update worker status');
    }

    await this.centrifugoService.publish(this.topic, data);
  }

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(this.topic);

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as IWorkerPayload;

      if (!data) {
        throw new Error('Received message without value');
      }

      if (data.action === EWorkerAction.create) {
        return this.createWorker(data);
      }

      if (data.action === EWorkerAction.delete) {
        return this.deleteWorker(data);
      }

      if (data.action === EWorkerAction.recreate) {
        return this.recreateWorker(data);
      }
    });

    await stream.start();
  }
}
