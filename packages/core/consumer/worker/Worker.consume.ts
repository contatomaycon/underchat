import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
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
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

@injectable()
export class WorkerConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService,
    private readonly centrifugoService: CentrifugoService,
    private readonly kafkaBalanceQueueService: KafkaBalanceQueueService,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService
  ) {}

  private queueCentrifugo(data: IWorkerPayload): string {
    return `worker.${data.account_id}`;
  }

  private async getHealthStatusCode(workerId: string): Promise<string> {
    const cmd = `docker exec ${workerId} sh -c 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3005/v1/health/check'`;

    const exec = promisify(execCallback);
    const { stdout } = await exec(cmd);

    return stdout.trim();
  }

  private async isServiceHealthy(workerId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        const code = await this.getHealthStatusCode(workerId);

        if (code === '200') {
          return true;
        }

        await new Promise((r) => setTimeout(r, 1000));
      } catch {}
    }

    return false;
  }

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

    return this.centrifugoService.publish(this.queueCentrifugo(data), data);
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

    const healthy = await this.isServiceHealthy(containerId);

    if (!healthy) {
      await this.updateWorkerErrorStatus(data);

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
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to update worker status');
    }

    data.worker_status_id = EWorkerStatus.disponible;

    await this.centrifugoService.publish(this.queueCentrifugo(data), data);
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

    data.worker_status_id = EWorkerStatus.delete;

    await this.centrifugoService.publish(this.queueCentrifugo(data), data);
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

    const healthy = await this.isServiceHealthy(containerId);

    if (!healthy) {
      await this.updateWorkerErrorStatus(data);

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
      await this.updateWorkerErrorStatus(data);

      throw new Error('Failed to update worker status');
    }

    data.worker_status_id = EWorkerStatus.disponible;

    await this.centrifugoService.publish(this.queueCentrifugo(data), data);
  }

  public async execute(): Promise<void> {
    const worker = this.kafkaBalanceQueueService.worker(
      balanceEnvironment.serverId
    );
    const stream: KStream = this.kafkaStreams.getKStream(worker);

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
        await this.kafkaBaileysQueueService.delete(data.worker_id);

        return this.deleteWorker(data);
      }

      if (data.action === EWorkerAction.recreate) {
        await this.kafkaBaileysQueueService.delete(data.worker_id);

        return this.recreateWorker(data);
      }
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
