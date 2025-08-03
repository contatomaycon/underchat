import { injectable, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { StatusConnectionWorkerRequest } from '@core/schema/worker/statusConnection/request.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { BaileysService } from '@core/services/baileys';
import { KafkaStreams, KStream } from 'kafka-streams';
import { EBaileysConnectionType } from '@core/common/enums/EBaileysConnectionType';

@injectable()
export class WorkerConnectionStatusConsume {
  constructor(
    private readonly baileysService: BaileysService,
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams
  ) {}

  public async execute(): Promise<void> {
    const topic = `worker.${baileysEnvironment.baileysWorkerId}.status`;
    const stream: KStream = this.kafkaStreams.getKStream(topic);

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach(async (msg) => {
      const data = msg.value as StatusConnectionWorkerRequest;

      if (!data) {
        throw new Error('Received message without value');
      }

      if (data.status === EWorkerStatus.online) {
        await this.baileysService.connect({
          initial_connection: true,
          type: data.type as EBaileysConnectionType,
          phone_connection: data.phone_connection,
        });

        return;
      }

      if (data.status === EWorkerStatus.disponible) {
        this.baileysService.disconnect({
          initial_connection: true,
          disconnected_user: true,
        });
      }
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
