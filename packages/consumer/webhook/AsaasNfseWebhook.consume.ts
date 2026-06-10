import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';
import { createConsumer } from '@core/common/functions/createConsumer';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { FastifyInstance } from 'fastify';
import { NfseProcessorService } from '@core/services/nfseProcessor.service';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { commitOffset } from '@core/common/functions/commitOffset';

@singleton()
export class AsaasNfseWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(NfseProcessorService)
    private readonly nfseProcessorService: NfseProcessorService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();

    await ensureKafkaTopic(
      this.kafka,
      topic,
      this.kafkaServiceQueueService.getNumPartitions(),
      this.kafkaServiceQueueService.getReplicationFactor()
    );

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-asaas-nfse-webhook'
    );

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        server.log.warn('Skipping message without value or invalid JSON');
        await this.commitNext(topic, message.partition, message.offset);

        return;
      }

      try {
        await this.handleWebhookEvent(data);
        await this.commitNext(topic, message.partition, message.offset);
      } catch (error) {
        server.log.error(
          error,
          `Error processing nfse webhook event: ${data.event}`
        );

        if (this.shouldCommitOnError(error)) {
          server.log.warn(
            `Skipping non-retryable nfse webhook event: ${data.event}`
          );
          await this.commitNext(topic, message.partition, message.offset);
        }
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
    if (!this.consumer) return;

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
    await commitOffset(this.consumerOrThrow, topic, partition, offset);
  }

  private async handleWebhookEvent(
    data: AsaasNfseWebhookRequest
  ): Promise<void> {
    await this.nfseProcessorService.processWebhookEvent(data);
  }

  private shouldCommitOnError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.includes('Payment ID não encontrado no webhook') ||
      error.message.startsWith('Account payment não encontrado para billing:')
    );
  }

  private parseMessage(value: Buffer | null): AsaasNfseWebhookRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AsaasNfseWebhookRequest;
      return parsed ?? null;
    } catch {
      return null;
    }
  }
}
