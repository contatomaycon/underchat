import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { WorkerService } from '@core/services/worker.service';
import { balanceEnvironment } from '@core/config/environments';
import { IDeleteWorker } from '@core/common/interfaces/IDeleteWorker';

@injectable()
export class WorkerDeleterConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService
  ) {}

  public async execute(): Promise<void> {
    const topic = `delete.${balanceEnvironment.serverId}.worker`;
    const stream: KStream = this.kafkaStreams.getKStream(topic);

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as IDeleteWorker;

      if (!data) {
        throw new Error('Received message without value');
      }

      const existsWorkerById = await this.workerService.existsWorkerById(
        data.is_administrator,
        data.account_id,
        data.worker_id
      );

      if (!existsWorkerById) {
        throw new Error('Worker not found');
      }

      const containerId = await this.workerService.removeContainerWorker(
        data.worker_id
      );

      if (!containerId) {
        throw new Error('Worker removal failed');
      }

      const deleteWorkerById = await this.workerService.deleteWorkerById(
        data.is_administrator,
        data.account_id,
        data.worker_id
      );

      if (!deleteWorkerById) {
        throw new Error('Failed to delete worker');
      }
    });

    await stream.start();
  }
}
