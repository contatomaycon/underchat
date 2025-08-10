import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';

@singleton()
export class WorkerSendMessageConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService
  ) {}

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaBaileysQueueService.workerSendMessage(
        baileysEnvironment.baileysWorkerId
      )
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    let chain: Promise<void> = Promise.resolve();

    stream.forEach(async (msg) => {
      chain = chain.then(async () => {
        const data = msg.value as IChatMessage;

        if (!data) {
          throw new Error('Received message without value');
        }

        if (data.content.type === EMessageType.text) {
          if (!data.content.message) {
            throw new Error('Received message without content');
          }

          await this.baileysMessageTextService.sendText(
            data.phone,
            data.content.message
          );

          return;
        }
      });
    });

    await stream.start();
  }

  public async close(): Promise<void> {
    await this.kafkaStreams.closeAll();
  }
}
