import { singleton, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { WorkerService } from '@core/services/worker.service';
import { getStatusWorkerConnection } from '@core/common/functions/getStatusWorkerConnection';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';

@singleton()
export class WorkerConnectionConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
  ) {}

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaServiceQueueService.workerStatus()
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as IBaileysConnectionState;

      if (!data) {
        throw new Error('Received message without value');
      }

      const viewWorkerPhoneConnectionDate =
        await this.workerService.viewWorkerPhoneConnectionDate(data.worker_id);

      if (!viewWorkerPhoneConnectionDate) {
        return;
      }

      const phoneNumber = data.phone ?? viewWorkerPhoneConnectionDate.number;

      const status = getStatusWorkerConnection(
        data.status,
        phoneNumber,
        data.disconnected_user
      );

      await this.workerService.updateWorkerPhoneStatusConnectionDate({
        worker_id: data.worker_id,
        status,
        number: phoneNumber,
        connection_date: viewWorkerPhoneConnectionDate.connection_date,
      });
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
