import { singleton, inject } from 'tsyringe';
import { baileysEnvironment } from '@core/config/environments';
import { KafkaBaileysQueueService } from '@core/services/kafkaBaileysQueue.service';
import { BaileysMessageTextService } from '@core/services/baileys/methods/messageText.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { StreamProducerService } from '@core/services/streamProducer.service';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { IUpdateMessage } from '@core/common/interfaces/IUpdateMessage';
import { proto, WAMessage, WAUrlInfo } from '@whiskeysockets/baileys';
import { KeyedSequencerService } from '@core/services/keyedSequencer.service';
import { Kafka, Consumer } from 'kafkajs';

@singleton()
export class MessageSendConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaBaileysQueueService: KafkaBaileysQueueService,
    private readonly baileysMessageTextService: BaileysMessageTextService,
    private readonly streamProducerService: StreamProducerService,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly keyedSequencerService: KeyedSequencerService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer) return;

    const topic = this.kafkaBaileysQueueService.workerSendMessage(
      baileysEnvironment.baileysWorkerId
    );

    this.consumer = this.kafka.consumer({
      groupId: `group-underchat-baileys-send-${baileysEnvironment.baileysWorkerId}`,
      retry: { retries: 8, initialRetryTime: 300 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const data = this.parseMessage(message.value);
        if (!data) return;

        const chatId =
          data.chat_id ?? data.message_key?.remote_jid ?? data.phone;
        if (!chatId) return;

        await this.keyedSequencerService.enqueue(String(chatId), async () => {
          await this.processMessage(data);
        });
      },
      partitionsConsumedConcurrently: 1,
    });
  }

  private parseMessage(value: Buffer | null): IChatMessage | null {
    if (!value) return null;
    const raw = value.toString('utf8').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as IChatMessage;
    } catch {
      return null;
    }
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const phoneSend = data.message_key?.remote_jid ?? data.phone;

    if (data?.content?.type === EMessageType.text && data.content?.message) {
      const result = await this.baileysMessageTextService.sendText(
        phoneSend,
        data.content.message,
        { linkPreview: data.content.link_preview as WAUrlInfo }
      );

      if (!result) {
        throw new Error('Failed to send message');
      }

      const inputUpdate: IUpdateMessage = { message: result, data };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        inputUpdate
      );
    }

    if (
      data?.content?.type === EMessageType.text_quoted &&
      data.content?.message &&
      data.content?.quoted
    ) {
      const contentQuoted = data.content?.quoted;

      const quoted: WAMessage = {
        key: {
          remoteJid: contentQuoted.key.remote_jid,
          fromMe: contentQuoted.key.from_me,
          id: contentQuoted.key.id,
          senderLid: contentQuoted.key.sender_lid ?? undefined,
          senderPn: contentQuoted.key.sender_pn ?? undefined,
          participant: contentQuoted.key.participant,
          participantLid: contentQuoted.key.participant_lid ?? undefined,
          participantPn: contentQuoted.key.participant_pn ?? undefined,
        },
        message: contentQuoted.message as proto.IMessage | null,
      };

      const result = await this.baileysMessageTextService.sendTextQuoted(
        phoneSend,
        data.content.message,
        quoted
      );

      if (!result) {
        throw new Error('Failed to send message');
      }

      const inputUpdate: IUpdateMessage = { message: result, data };

      await this.streamProducerService.send(
        this.kafkaServiceQueueService.updateMessage(),
        inputUpdate
      );
    }
  }

  public async close(): Promise<void> {
    await this.keyedSequencerService.drain();
    if (!this.consumer) return;
    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}
