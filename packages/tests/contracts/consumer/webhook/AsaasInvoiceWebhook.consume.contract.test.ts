import 'reflect-metadata';

jest.mock('@core/services/planRelease.service', () => ({
  PlanReleaseService: class {},
}));

const mockKafkaRunnerOptions: unknown[] = [];
jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class {
    consumer = { id: 'consumer' };

    constructor(options: unknown) {
      mockKafkaRunnerOptions.push(options);
    }

    start = jest.fn(async (onConnected?: () => void) => onConnected?.());
    close = jest.fn(async () => undefined);
  },
}));

import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';

describe('AsaasInvoiceWebhookConsume', () => {
  const makeConsumer = (
    planReleaseService = { processPaymentWebhook: jest.fn() },
    kafkaServiceQueueService = {
      asaasInvoiceWebhook: jest.fn(() => 'asaas-invoice'),
    }
  ) =>
    new AsaasInvoiceWebhookConsume(
      {} as never,
      kafkaServiceQueueService as never,
      planReleaseService as never
    );

  beforeEach(() => {
    mockKafkaRunnerOptions.length = 0;
  });

  it('serializes each payment and retries an early webhook for a bounded window', async () => {
    const consumer = makeConsumer();

    await consumer.execute({
      log: { warn: jest.fn(), error: jest.fn() },
    } as never);

    expect(mockKafkaRunnerOptions).toHaveLength(1);
    expect(mockKafkaRunnerOptions[0]).toEqual(
      expect.objectContaining({
        topic: 'asaas-invoice',
        preserveEntityOrder: true,
        maxRetries: 6,
        retryDelaysMs: [1000, 5000, 15000, 30000, 60000],
      })
    );
  });

  it('commits non-retryable webhook payload errors', () => {
    const consumer = makeConsumer() as unknown as {
      shouldCommitOnError(error: unknown): boolean;
    };

    expect(
      consumer.shouldCommitOnError(new Error('Unhandled event type: PAYMENT_X'))
    ).toBe(true);
    expect(
      consumer.shouldCommitOnError(new Error('Status desconhecido: UNKNOWN'))
    ).toBe(true);
  });

  it('keeps transient processing failures retryable', () => {
    const consumer = makeConsumer() as unknown as {
      shouldCommitOnError(error: unknown): boolean;
    };

    expect(
      consumer.shouldCommitOnError(new Error('Falha temporária no banco'))
    ).toBe(false);
    expect(
      consumer.shouldCommitOnError(new Error('Pagamento não encontrado: pay_1'))
    ).toBe(false);
    expect(
      consumer.shouldCommitOnError(
        Object.assign(new Error('plan_entitlement_deny_fence_required'), {
          code: 'UC001',
        })
      )
    ).toBe(false);
  });

  it('ignores checkout viewed events without processing payment status', async () => {
    const planReleaseService = { processPaymentWebhook: jest.fn() };
    const consumer = makeConsumer(planReleaseService) as unknown as {
      handleWebhookEvent(data: unknown): Promise<void>;
    };

    await expect(
      consumer.handleWebhookEvent({
        event: 'PAYMENT_CHECKOUT_VIEWED',
        payment: { id: 'pay_1' },
      })
    ).resolves.toBeUndefined();
    expect(planReleaseService.processPaymentWebhook).not.toHaveBeenCalled();
  });

  it('routes new PAYMENT status events through the authoritative status mapper', async () => {
    const planReleaseService = {
      processPaymentWebhook: jest.fn(async () => undefined),
    };
    const consumer = makeConsumer(planReleaseService) as unknown as {
      handleWebhookEvent(data: unknown): Promise<void>;
    };
    const event = {
      event: 'PAYMENT_CHARGEBACK_REQUESTED',
      payment: { id: 'pay_1', status: 'CHARGEBACK_REQUESTED' },
    };

    await expect(consumer.handleWebhookEvent(event)).resolves.toBeUndefined();
    expect(planReleaseService.processPaymentWebhook).toHaveBeenCalledWith(
      event
    );
  });
});
