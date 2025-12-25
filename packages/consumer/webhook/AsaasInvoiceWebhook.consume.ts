import { singleton, inject } from 'tsyringe';
import { KafkaConsumer } from 'node-rdkafka';
import { KafkaClient } from '@core/plugins/kafkaStreams';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasInvoiceWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { createConsumer } from '@core/common/functions/createConsumer';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { FastifyInstance } from 'fastify';
import { PlanReleaseService } from '@core/services/planRelease.service';

@singleton()
export class AsaasInvoiceWebhookConsume {
  private consumer: KafkaConsumer | null = null;
  private isRunning = false;

  constructor(
    @inject('Kafka') private readonly kafka: KafkaClient,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly planReleaseService: PlanReleaseService
  ) {}

  private get consumerOrThrow(): KafkaConsumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer && this.isRunning) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-asaas-invoice-webhook'
    );

    const topic = this.kafkaServiceQueueService.asaasInvoiceWebhook();

    await ensureKafkaTopic(this.kafka, topic);

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
          `Error processing webhook event: ${data.event}`
        );
      } finally {
        stop();
      }

      await this.commitNext(topic, message.partition, message.offset);
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
      default:
        throw new Error(`Unhandled event type: ${data.event}`);
    }
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
