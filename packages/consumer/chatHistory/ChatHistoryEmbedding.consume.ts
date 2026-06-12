import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { EmbeddingService } from '@core/services/embedding.service';
import { IChatHistoryEmbeddingRequest } from '@core/common/interfaces/IChatHistoryEmbeddingRequest';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class ChatHistoryEmbeddingConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<IChatHistoryEmbeddingRequest> | null =
    null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(EmbeddingService)
    private readonly embeddingService: EmbeddingService
  ) {}

  public async execute(): Promise<void> {
    if (this.consumer && this.isRunning) {
      return;
    }

    const topic = this.kafkaServiceQueueService.chatHistoryEmbedding();
    this.runner = new KafkaConsumerRunner<IChatHistoryEmbeddingRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-chat-history-embedding',
      parse: (message) => this.parseRequest(message.value),
      resolveEntityKey: (data) =>
        `${data.account_id}:${data.ai_agent_id}:${data.phone}`,
      handle: async (data) => {
        try {
          await this.processEmbedding(data);
        } catch (error) {
          console.error(
            '[ChatHistoryEmbedding] Erro ao processar embedding:',
            error
          );
        }
      },
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

  private parseRequest(
    value: Buffer | null
  ): IChatHistoryEmbeddingRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as IChatHistoryEmbeddingRequest;
      if (
        parsed &&
        'account_id' in parsed &&
        'ai_agent_id' in parsed &&
        'phone' in parsed &&
        parsed.phone
      ) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async processEmbedding(
    data: IChatHistoryEmbeddingRequest
  ): Promise<void> {
    await this.embeddingService.processMultipleChatHistoryEmbeddings(
      data.account_id,
      data.phone,
      data.ai_agent_id
    );
  }
}
