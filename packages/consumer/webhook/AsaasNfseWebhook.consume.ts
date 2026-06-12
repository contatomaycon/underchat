import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasNfseWebhookRequest } from '@core/schema/nfse/Webhook/request.schema';
import { FastifyInstance } from 'fastify';
import { NfseProcessorService } from '@core/services/nfseProcessor.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class AsaasNfseWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<AsaasNfseWebhookRequest> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(NfseProcessorService)
    private readonly nfseProcessorService: NfseProcessorService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.asaasNfseWebhook();
    this.runner = new KafkaConsumerRunner<AsaasNfseWebhookRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-asaas-nfse-webhook',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.invoice.id,
      handle: async (data) => {
        try {
          await this.handleWebhookEvent(data);
        } catch (error) {
          if (this.shouldCommitOnError(error)) {
            server.log.warn(
              { err: error },
              `Skipping non-retryable nfse webhook event: ${data.event}`
            );
            return;
          }

          server.log.error(
            error,
            `Error processing nfse webhook event: ${data.event}`
          );
          throw error;
        }
      },
      onInvalidMessage: () => {
        server.log.warn('Skipping message without value or invalid JSON');
      },
      maxRetries: 3,
      retryDelaysMs: [1000, 5000, 15000],
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
