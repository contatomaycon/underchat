import 'reflect-metadata';

jest.mock('@core/services/planRelease.service', () => ({
  PlanReleaseService: class {},
}));

jest.mock('@core/common/functions/kafkaConsumerRunner', () => ({
  KafkaConsumerRunner: class {},
}));

import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';

describe('AsaasInvoiceWebhookConsume', () => {
  const makeConsumer = (
    planReleaseService = { processPaymentWebhook: jest.fn() }
  ) =>
    new AsaasInvoiceWebhookConsume(
      {} as never,
      {} as never,
      planReleaseService as never
    );

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
    expect(
      consumer.shouldCommitOnError(new Error('Pagamento não encontrado: pay_1'))
    ).toBe(true);
  });

  it('keeps transient processing failures retryable', () => {
    const consumer = makeConsumer() as unknown as {
      shouldCommitOnError(error: unknown): boolean;
    };

    expect(
      consumer.shouldCommitOnError(new Error('Falha temporária no banco'))
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
});
