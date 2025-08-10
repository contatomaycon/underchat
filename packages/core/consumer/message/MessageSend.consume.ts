import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaStreams, KStream } from 'kafka-streams';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';

@singleton()
export class MessageSendConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService
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

        const phoneSend = data.message_key?.jid ?? data.phone;

        if (data.content.type === EMessageType.text) {
          if (!data.content.message) {
            throw new Error('Received message without content');
          }

          const result = await this.baileysMessageTextService.sendText(
            phoneSend,
            data.content.message
          );

          if (!result) {
            throw new Error('Failed to send message');
          }

          const inputUpdate: IUpdateMessage = {
            message: result,
            data,
          };

          await this.streamProducerService.send(
            this.kafkaServiceQueueService.updateMessage(),
            inputUpdate
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
