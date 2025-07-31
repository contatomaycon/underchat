import { injectable, inject } from 'tsyringe';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { WorkerService } from '@core/services/worker.service';

@injectable()
export class WorkerConnectionConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly workerService: WorkerService
  ) {}

  private getStatus(
    status: EBaileysConnectionStatus,
    disconnectedUser?: boolean
  ): EWorkerStatus {
    if (status === EBaileysConnectionStatus.connected) {
      return EWorkerStatus.online;
    }

    if (status === EBaileysConnectionStatus.disconnected && disconnectedUser) {
      return EWorkerStatus.disponible;
    }

    return EWorkerStatus.offline;
  }

  public async execute(): Promise<void> {
    const topic = 'worker.status';
    const stream: KStream = this.kafkaStreams.getKStream(topic);

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

      const status = this.getStatus(data.status, data.disconnected_user);

      await this.workerService.updateWorkerPhoneStatusConnectionDate({
        worker_id: data.worker_id,
        status,
        number: data.phone ?? viewWorkerPhoneConnectionDate.number,
        connection_date: viewWorkerPhoneConnectionDate.connection_date,
      });
    });

    await stream.start();
  }
}
