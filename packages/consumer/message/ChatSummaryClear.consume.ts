import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IClearChatSummaryMessage } from '@core/common/interfaces/IClearChatSummaryMessage';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ChatSummaryClearConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IClearChatSummaryMessage> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

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

    const topic = this.kafkaServiceQueueService.clearChatSummary();
    this.runner = new KafkaConsumerRunner<IClearChatSummaryMessage>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-chat-summary-clear',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id ?? 'unknown-account'}:${data.chat_id ?? 'unknown-chat'}`,
      handle: (data) => this.handleMessage(data),
      logger: console,
    });

    await this.runner.start(() => {
      this.isRunning = true;
    });
    this.consumer = this.runner.consumer;
  }

  public async close(): Promise<void> {
    this.isRunning = false;
    if (this.runner) {
      await this.runner.close();
      this.runner = null;
    }
    this.consumer = null;
  }
}
