import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';
import { createConsumer } from '@core/common/functions/createConsumer';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { FastifyInstance } from 'fastify';
import { NfseProcessorService } from '@core/services/nfseProcessor.service';

@singleton()
export class AsaasNfseWebhookConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly nfseProcessorService: NfseProcessorService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-asaas-nfse-webhook'
    );

    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();

    await ensureKafkaTopic(this.kafka, topic);
    await this.consumer.connect();
    await this.consumer.subscribe({ topic, fromBeginning: true });

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message, heartbeat }) => {
        const data = this.parseMessage(message.value);

        if (!data) {
          server.log.warn('Skipping message without value or invalid JSON');
          await this.commitNext(topic, partition, message.offset);

          return;
        }

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

        await this.commitNext(topic, partition, message.offset);
      },
    });
  }

  public async close(): Promise<void> {
    if (!this.consumer) return;

    try {
      await this.consumer.stop();
    } finally {
      await this.consumer.disconnect();
      this.consumer = null;
    }
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
