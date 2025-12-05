import { singleton, inject } from 'tsyringe';
import { Kafka, Consumer } from 'kafkajs';
import { KafkaServiceQueueService } from '@core/services/kafkaServiceQueue.service';
import { AsaasPaymentWebhookRequest } from '@core/schema/payment/Webhook/request.schema';
import { createConsumer } from '@core/common/functions/createConsumer';
import { startHeartbeat } from '@core/common/functions/startHeartbeat';
import { ensureKafkaTopic } from '@core/common/functions/ensureKafkaTopic';
import { FastifyInstance } from 'fastify';
import { PlanReleaseService } from '@core/services/planRelease.service';

@singleton()
export class AsaasPaymentWebhookConsume {
  private consumer: Consumer | null = null;

  constructor(
    @inject('Kafka') private readonly kafka: Kafka,
    private readonly kafkaServiceQueueService: KafkaServiceQueueService,
    private readonly planReleaseService: PlanReleaseService
  ) {}

  private get consumerOrThrow(): Consumer {
    if (!this.consumer) throw new Error('Consumer not initialized');

    return this.consumer;
  }

  async execute(server: FastifyInstance): Promise<void> {
    if (this.consumer) return;

    this.consumer = createConsumer(
      this.kafka,
      'group-underchat-asaas-payment-webhook'
    );

    const topic = this.kafkaServiceQueueService.asaasPaymentWebhook();

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
          await this.handleWebhookEvent(server, data);
        } catch (error) {
          server.log.error(
            error,
            `Error processing webhook event: ${data.event}`
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
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(
      `Processing Asaas payment webhook event: ${data.event} for payment ${data.payment.id}`
    );

    switch (data.event) {
      case 'PAYMENT_CREATED':
        await this.handlePaymentCreated(server, data);
        break;
      case 'PAYMENT_RECEIVED':
        await this.handlePaymentReceived(server, data);
        break;
      case 'PAYMENT_CONFIRMED':
        await this.handlePaymentConfirmed(server, data);
        break;
      case 'PAYMENT_OVERDUE':
        await this.handlePaymentOverdue(server, data);
        break;
      case 'PAYMENT_REFUNDED':
        await this.handlePaymentRefunded(server, data);
        break;
      default:
        server.log.info(`Unhandled event type: ${data.event}`);
    }
  }

  private async handlePaymentCreated(
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(`Payment created: ${data.payment.id}`);
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentReceived(
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(`Payment received: ${data.payment.id}`);
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentConfirmed(
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(`Payment confirmed: ${data.payment.id}`);
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentOverdue(
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(`Payment overdue: ${data.payment.id}`);
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private async handlePaymentRefunded(
    server: FastifyInstance,
    data: AsaasPaymentWebhookRequest
  ): Promise<void> {
    server.log.info(`Payment refunded: ${data.payment.id}`);
    await this.planReleaseService.processPaymentWebhook(data);
  }

  private parseMessage(
    value: Buffer | null
  ): AsaasPaymentWebhookRequest | null {
    if (!value) {
      return null;
    }

    const raw = value.toString('utf8').trim();
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as AsaasPaymentWebhookRequest;
      return parsed ?? null;
    } catch {
      return null;
    }
  }
}
