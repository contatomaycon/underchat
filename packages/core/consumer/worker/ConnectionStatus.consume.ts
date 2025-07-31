import { injectable, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { KafkaStreams, KStream } from 'kafka-streams';
import { IKafkaMsg } from '@core/common/interfaces/IKafkaMsg';

@injectable()
export class ConnectionStatusConsume {
  constructor(
    private readonly baileysService: BaileysService,
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams
  ) {}

  async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      `worker:${baileysEnvironment.baileysWorkerId}:status`
    );

    stream.mapBufferKeyToString();
    stream.mapBufferValueToString();

    stream.forEach(async (message: IKafkaMsg) => {
      let data: StatusConnectionWorkerRequest;
      try {
        const raw =
          message instanceof Buffer
            ? message.toString('utf8')
            : String(message);
        data = JSON.parse(raw) as StatusConnectionWorkerRequest;
      } catch {
        return;
      }

      if (data.status === EWorkerStatus.online) {
        await this.baileysService.connect(true);

        return;
      }

      if (data.status === EWorkerStatus.disponible) {
        this.baileysService.disconnect(true);

        return;
      }
    });
  }
}
