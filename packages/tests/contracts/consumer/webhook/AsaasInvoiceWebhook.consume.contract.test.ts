import 'reflect-metadata';
import { AsaasInvoiceWebhookConsume } from '@core/consumer/webhook/AsaasInvoiceWebhook.consume';

describe('AsaasInvoiceWebhookConsume', () => {
  const makeConsumer = () =>
    new AsaasInvoiceWebhookConsume({} as never, {} as never, {} as never);

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
});
