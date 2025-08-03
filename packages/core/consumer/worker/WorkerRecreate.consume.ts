import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { WorkerService } from '@core/services/worker.service';
import { balanceEnvironment } from '@core/config/environments';
import { IRecreateWorker } from '@core/common/interfaces/IRecreateWorker';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerRecreateConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService
  ) {}

  public async execute(): Promise<void> {
    const topic = `recreate.${balanceEnvironment.serverId}.worker`;
    const stream: KStream = this.kafkaStreams.getKStream(topic);

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as IRecreateWorker;

      if (!data) {
        throw new Error('Received message without value');
      }

      const viewWorkerType = await this.workerService.viewWorkerType(
        data.account_id,
        data.is_administrator,
        data.worker_id
      );

      if (!viewWorkerType) {
        throw new Error('Worker not found');
      }

      const removeContainerWorker =
        await this.workerService.removeContainerWorker(data.worker_id, false);

      if (!removeContainerWorker) {
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
        throw new Error('Failed to update worker status');
      }
    });

    await stream.start();
  }
}
