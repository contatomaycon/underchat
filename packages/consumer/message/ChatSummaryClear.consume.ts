import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IClearChatSummaryMessage } from '@core/common/interfaces/IClearChatSummaryMessage';

@singleton()
export class ChatSummaryClearConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;
  private processingChain: Promise<void> = Promise.resolve();

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    return this.consumer;
  }

  private parseMessage(value: Buffer | null): IClearChatSummaryMessage | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IClearChatSummaryMessage;
      return parsed ?? null;
    } catch {
      return null;
    }
  }

  private async handleMessage(data: IClearChatSummaryMessage): Promise<void> {
    if (!data.chat_id || !data.account_id) return;

    await this.chatService.clearChatSummary(data.chat_id, data.account_id);

    const updatedChat = await this.chatService.findChatByChatId(
      data.account_id,
      data.chat_id
    );

    if (!updatedChat) return;

    const channelAccountId = updatedChat.account.id;

    await this.centrifugoService.publishSub(
      chatAccountCentrifugo(channelAccountId),
      updatedChat
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-chat-summary-clear'
    );

    const topic = this.kafkaServiceQueueService.clearChatSummary();

    await ensureKafkaTopic(this.kafka, topic);

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const offset = message.offset;

      this.processingChain = this.processingChain.then(async () => {
        const heartbeat = async () => {
          this.consumer?.commit();
        };

        const stop = startHeartbeat(heartbeat);

        try {
          await this.handleMessage(data);
        } catch {
          await this.commitNext(topic, message.partition, message.offset);
        } finally {
          stop();
        }

        await this.commitNext(topic, message.partition, offset);
      });
    });

    this.consumer.on('event.error', (err) => {
      console.error('Consumer error:', err);
    });

    this.consumer.subscribe([topic]);

    await new Promise<void>((resolve, reject) => {
      const consumer = this.consumer;
      if (!consumer) {
        reject(new Error('Consumer not initialized'));
        return;
      }
      consumer.connect({}, (err) => {
        if (err) {
          reject(err);
          return;
        }
        consumer.consume();
        this.isRunning = true;
        resolve();
      });
    });
  }

  public async close(): Promise<void> {
    await this.processingChain;

    if (!this.consumer) {
      return;
    }

    try {
      this.isRunning = false;
      await new Promise<void>((resolve) => {
        const consumer = this.consumer;
        if (!consumer) {
          resolve();
          return;
        }
        consumer.unsubscribe();
        consumer.disconnect(resolve);
      });
    } finally {
      this.consumer = null;
    }
  }

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
  }
}
