import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { IClearChatSummaryMessage } from '@core/common/interfaces/IClearChatSummaryMessage';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';
import { SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS } from '@core/common/functions/serviceApiWhatsappConsumerBindings';

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

  private async handleMessage(
    data: IClearChatSummaryMessage,
    assertActive: () => void = () => undefined
  ): Promise<void> {
    if (!data.chat_id || !data.account_id) return;

    const rawOperationId = data.operation_id?.trim() || null;
    const operationId =
      rawOperationId && rawOperationId.length <= 128 ? rawOperationId : null;
    const hasExpectedSummaryRevision =
      Object.prototype.hasOwnProperty.call(data, 'expected_summary_revision') &&
      typeof data.expected_summary_revision === 'number' &&
      Number.isSafeInteger(data.expected_summary_revision) &&
      data.expected_summary_revision >= 0;
    const rawExpectedLastMessageId = data.expected_last_message_id;
    const expectedLastMessageId =
      typeof rawExpectedLastMessageId === 'string'
        ? rawExpectedLastMessageId.trim()
        : rawExpectedLastMessageId;
    const hasExpectedLastMessageId =
      Object.prototype.hasOwnProperty.call(data, 'expected_last_message_id') &&
      (expectedLastMessageId === null ||
        (typeof expectedLastMessageId === 'string' &&
          expectedLastMessageId.length > 0 &&
          expectedLastMessageId.length <= 1_000));

    // Clearing unread state is destructive. Every accepted command must carry
    // the complete identity and OCC snapshot emitted by the current producer.
    // Old/partial commands are intentionally discarded instead of guessing.
    if (
      operationId === null ||
      !hasExpectedSummaryRevision ||
      !hasExpectedLastMessageId
    ) {
      return;
    }

    assertActive();
    const cleared = await this.chatService.clearChatSummary(
      data.chat_id,
      data.account_id,
      {
        operationId,
        enforceExpectedSummaryRevision: true,
        expectedSummaryRevision: data.expected_summary_revision,
        enforceExpectedLastMessageId: true,
        expectedLastMessageId,
        assertActive,
      }
    );
    if (!cleared) return;

    const updatedChat = await this.chatService.findChatByChatId(
      data.account_id,
      data.chat_id
    );

    if (!updatedChat) return;

    const channelAccountId = updatedChat.account.id;

    assertActive();
    await this.centrifugoService.publishSub(
      chatAccountCentrifugo(channelAccountId),
      updatedChat,
      assertActive
    );
  }

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.clearChatSummary();
    this.runner = new KafkaConsumerRunner<IClearChatSummaryMessage>({
      kafka: this.kafka,
      topic,
      groupId: SERVICE_API_WHATSAPP_CONSUMER_GROUP_IDS.chatSummaryClear,
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id ?? 'unknown-account'}:${data.chat_id ?? 'unknown-chat'}`,
      preserveEntityOrder: true,
      handle: (data, context) => this.handleMessage(data, context.assertActive),
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
