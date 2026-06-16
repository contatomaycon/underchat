import { singleton, inject } from 'tsyringe';
import type { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasInvoiceWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { FastifyInstance } from 'fastify';
import { PlanReleaseService } from '@core/services/planRelease.service';
import { KafkaConsumerRunner } from '@core/common/functions/kafkaConsumerRunner';

@singleton()
export class AsaasInvoiceWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private runner: KafkaConsumerRunner<AsaasInvoiceWebhookRequest> | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    @inject(KafkaServiceQueueService)
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    @inject(PlanReleaseService)
    private readonly planReleaseService: PlanReleaseService
  ) {}

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    const topic = this.kafkaServiceQueueService.asaasInvoiceWebhook();
    this.runner = new KafkaConsumerRunner<AsaasInvoiceWebhookRequest>({
      kafka: this.kafka,
      topic,
      groupId: 'group-underchat-asaas-invoice-webhook',
      parse: (message) => this.parseMessage(message.value),
      resolveEntityKey: (data) => data.payment.id,
      handle: async (data) => {
        try {
          await this.handleWebhookEvent(data);
        } catch (error) {
          if (this.shouldCommitOnError(error)) {
            server.log.warn(
              { err: error },
              `Skipping non-retryable invoice webhook event: ${data.event}`
            );
            return;
          }

          server.log.error(
            error,
            `Error processing webhook event: ${data.event}`
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
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    switch (data.event) {
      case 'PAYMENT_CREATED':
        await this.handlePaymentCreated(data);
        break;
      case 'PAYMENT_RECEIVED':
        await this.handlePaymentReceived(data);
        break;
      case 'PAYMENT_CONFIRMED':
        await this.handlePaymentConfirmed(data);
        break;
      case 'PAYMENT_OVERDUE':
        await this.handlePaymentOverdue(data);
        break;
      case 'PAYMENT_REFUNDED':
        await this.handlePaymentRefunded(data);
        break;
      case 'PAYMENT_CHECKOUT_VIEWED':
        break;
      default:
        throw new Error(`Unhandled event type: ${data.event}`);
    }
  }

  private shouldCommitOnError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.message.startsWith('Unhandled event type:') ||
      error.message.startsWith('Status desconhecido:') ||
      error.message.startsWith('Pagamento não encontrado:')
    );
  }

  private async handlePaymentCreated(
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentReceived(
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentConfirmed(
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentOverdue(
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentRefunded(
    data: AsaasInvoiceWebhookRequest
  ): Promise<void> {
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private parseMessage(
    value: Buffer | null
  ): AsaasInvoiceWebhookRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AsaasInvoiceWebhookRequest;
      return parsed ?? null;
    } catch {
      return null;
    }
  }
}
