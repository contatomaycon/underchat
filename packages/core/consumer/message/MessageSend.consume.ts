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
import { WAMessage, WAUrlInfo } from '@whiskeysockets/baileys';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';

@singleton()
export class MessageSendConsume {
  constructor(
    @inject('KafkaStreams') private readonly kafkaStreams: KafkaStreams,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly keyedSequencerService: KeyedSequencerService
  ) {}

  public async execute(): Promise<void> {
    const stream: KStream = this.kafkaStreams.getKStream(
      this.kafkaBaileysQueueService.workerSendMessage(
        baileysEnvironment.baileysWorkerId
      )
    );

    stream.mapBufferKeyToString();
    stream.mapJSONConvenience();

    stream.forEach((msg) => {
      const data = msg.value as IChatMessage;
      if (!data) return;

      const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;

      if (!chatId) return;

      this.keyedSequencerService.enqueue(String(chatId), async () => {
        await this.processMessage(data);
      });
    });

    await stream.start();
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const phoneSend = data.message_key?.remote_jid ?? data.phone;

    if (data?.content?.type === EMessageType.text && data.content?.message) {
      const result = await this.baileysMessageTextService.sendText(
        phoneSend,
        data.content.message,
        { linkPreview: data.content.link_preview as WAUrlInfo }
      );

      if (!result) throw new Error('Failed to send message');

      const inputUpdate: IUpdateMessage = { message: result, data };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        inputUpdate
      );
    }

    if (
      data?.content?.type === EMessageType.text_quoted &&
      data.content?.message
    ) {
      const quoted = {
        key: {
          remoteJid: '556195999040@s.whatsapp.net',
          fromMe: true,
          id: '3AAEEDC13408FF632634',
        },
        message: 'Oi',
      } as WAMessage;

      const result = await this.baileysMessageTextService.sendTextQuoted(
        phoneSend,
        data.content.message,
        quoted
      );

      if (!result) throw new Error('Failed to send message');

      const inputUpdate: IUpdateMessage = { message: result, data };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        inputUpdate
      );
    }
  }

  public async close(): Promise<void> {
    await this.keyedSequencerService.drain();
    await this.kafkaStreams.closeAll();
  }
}
