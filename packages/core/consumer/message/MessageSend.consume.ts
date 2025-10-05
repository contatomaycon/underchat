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
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';

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

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  public async execute(): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      `group-underchat-baileys-send-${baileysEnvironment.baileysWorkerId}`
    );

    const topic = this.kafkaBaileysQueueService.workerSendMessage(
      baileysEnvironment.baileysWorkerId
    );

    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);
        if (!data) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const chatId = this.resolveChatId(data);
        if (!chatId) {
          await this.commitNext(topic, partition, message.offset);

          return;
        }

        const stop = startHeartbeat(heartbeat);
        try {
          await this.enqueueByChatId(chatId, async () => {
            await this.processMessage(data);

            return;
          });
        } finally {
          stop();
        }

        await this.commitNext(topic, partition, message.offset);

        return;
      },
    });

    return;
  }

  public async close(): Promise<void> {
    await this.keyedSequencerService.drain();

    if (!this.consumer) {
      return;
    }

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    return;
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: string
  ): Promise<void> {
    const next = (BigInt(offset) + 1n).toString();

    await this.consumerOrThrow.commitOffsets([
      { topic, partition, offset: next },
    ]);
  }

  private parseMessage(value: Buffer | null): IChatMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IChatMessage;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  private resolveChatId(data: IChatMessage): string | null {
    const chatId = data.chat_id ?? data.message_key?.remote_jid ?? data.phone;

    if (!chatId) {
      return null;
    }

    return String(chatId);
  }

  private async enqueueByChatId(
    chatId: string,
    task: () => Promise<void>
  ): Promise<void> {
    await this.keyedSequencerService.enqueue(chatId, task);
  }

  private async processMessage(data: IChatMessage): Promise<void> {
    const phone = data.message_key?.remote_jid ?? data.phone;

    if (data?.content?.type === EMessageType.text && data.content?.message) {
      await this.processText(phone, data);

      return;
    }

    if (
      data?.content?.type === EMessageType.text_quoted &&
      data.content?.message &&
      data.content?.quoted
    ) {
      await this.processTextQuoted(phone, data);

      return;
    }

    return;
  }

  private async processText(
    phone: string | null | undefined,
    data: IChatMessage
  ): Promise<void> {
    const to = phone ?? '';

    const result = await this.baileysMessageTextService.sendText(
      to,
      data.content?.message ?? '',
      { linkPreview: data.content?.link_preview as WAUrlInfo }
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private async processTextQuoted(
    phone: string | null | undefined,
    data: IChatMessage
  ): Promise<void> {
    const to = phone ?? '';
    const quoted = this.composeQuotedMessage(data);

    const result = await this.baileysMessageTextService.sendTextQuoted(
      to,
      data.content?.message ?? '',
      quoted
    );

    if (!result) {
      throw new Error('Failed to send message');
    }

    const update: IUpdateMessage = { message: result, data };
    await this.pushUpdate(update);
  }

  private composeQuotedMessage(data: IChatMessage): WAMessage {
    const q = data.content?.quoted;

    const quoted: WAMessage = {
      key: {
        remoteJid: q?.key.remote_jid ?? '',
        fromMe: q?.key.from_me ?? false,
        id: q?.key.id ?? '',
        participant: q?.key.participant ?? undefined,
      },
      message: (q?.message as proto.IMessage | null) ?? null,
    };

    return quoted;
  }

  private async pushUpdate(input: IUpdateMessage): Promise<void> {
    const topic = this.kafkaServiceQueueService.updateMessage();

    await this.streamProducerService.send(topic, input);
  }
}
