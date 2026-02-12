import { singleton, inject } from 'tsyringe';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';
import { EmbeddingService } from '@core/services/embedding.service';
import { IChatHistoryEmbeddingRequest } from '@core/common/interfaces/IChatHistoryEmbeddingRequest';

@singleton()
export class ChatHistoryEmbeddingConsume {
  private consumer: KafkaConsumer | null = null;
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

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-chat-history-embedding'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseRequest(message.value);

      if (!data) {
        await this.commitNext(topic, message.partition, message.offset);
        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.processEmbedding(data);
      } catch (error) {
        console.error(
          '[ChatHistoryEmbedding] Erro ao processar embedding:',
          error
        );
      } finally {
        stop();
        await this.commitNext(topic, message.partition, message.offset);
      }
    });

    this.consumer.on('event.error', (err) => {
      handleConsumerError(err, topic);
    });

    const consumer = this.consumer;
    if (!consumer) {
      throw new Error('Consumer not initialized');
    }

    connectConsumer(consumer, topic, () => {
      this.isRunning = true;
    });
  }

  public async close(): Promise<void> {
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

  private async commitNext(
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    if (!this.consumer) {
      return;
    }

    try {
      await commitOffset(this.consumer, topic, partition, offset);
    } catch (error) {
      console.error('Erro ao commitar mensagem:', error);
    }
  }
}
