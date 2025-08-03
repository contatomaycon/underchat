import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { WorkerService } from '@core/services/worker.service';
import { ICreateWorker } from '@core/common/interfaces/ICreateWorker';
import { getImageWorker } from '@core/common/functions/getImageWorker';
import { balanceEnvironment } from '@core/config/environments';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

@injectable()
export class WorkerCreateConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService
  ) {}

  public async execute(): Promise<void> {
    const topic = `create.${balanceEnvironment.serverId}.worker`;
    const stream: KStream = this.kafkaStreams.getKStream(topic);

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as ICreateWorker;

      if (!data) {
        throw new Error('Received message without value');
      }

      const imageName = getImageWorker(data.worker_type_id);

      const containerId = await this.workerService.createContainerWorker(
        imageName,
        data.worker_id
      );

      if (!containerId) {
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
        throw new Error('Failed to update worker status');
      }
    });

    await stream.start();
  }
}
