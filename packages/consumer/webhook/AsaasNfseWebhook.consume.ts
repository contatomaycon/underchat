import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';
import { createConsumer } from '@core/common/functions/createConsumer';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { connectConsumer } from '@core/common/functions/connectConsumer';
import { handleConsumerError } from '@core/common/functions/handleConsumerError';
import { FastifyInstance } from 'fastify';
import { NfseProcessorService } from '@core/services/nfseProcessor.service';

@singleton()
export class AsaasNfseWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly nfseProcessorService: NfseProcessorService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-asaas-nfse-webhook'
    );

    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();

    this.consumer.on('data', async (message) => {
      const data = this.parseMessage(message.value);

      if (!data) {
        server.log.warn('Skipping message without value or invalid JSON');
        await this.commitNext(topic, message.partition, message.offset);

        return;
      }

      const heartbeat = async () => {
        this.consumer?.commit();
      };

      const stop = startHeartbeat(heartbeat);
      try {
        await this.handleWebhookEvent(data);
      } catch (error) {
        server.log.error(
          error,
          `Error processing nfse webhook event: ${data.event}`
        );
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
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
    this.consumerOrThrow.commitSync([
      {
        topic,
        partition,
        offset: offset + 1,
      },
    ]);
  }

  private async handleWebhookEvent(
    data: AsaasNfseWebhookRequest
  ): Promise<void> {
    await this.nfseProcessorService.processWebhookEvent(data);
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
