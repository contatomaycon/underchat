import 'reflect-metadata';
import { AsaasNfseWebhookConsume } from '@core/consumer/webhook/AsaasNfseWebhook.consume';

describe('AsaasNfseWebhookConsume', () => {
  const makeConsumer = () =>
    new AsaasNfseWebhookConsume({} as never, {} as never, {} as never);

  it('commits non-retryable webhook payload errors', () => {
    const consumer = makeConsumer() as unknown as {
      shouldCommitOnError(error: unknown): boolean;
    };

    expect(
      consumer.shouldCommitOnError(
        new Error('Payment ID não encontrado no webhook')
      )
    ).toBe(true);
    expect(
      consumer.shouldCommitOnError(
        new Error('Account payment não encontrado para billing: pay_1')
      )
    ).toBe(true);
  });

  it('keeps transient Asaas invoice lookup failures retryable', () => {
    const consumer = makeConsumer() as unknown as {
      shouldCommitOnError(error: unknown): boolean;
    };

    expect(
      consumer.shouldCommitOnError(
        new Error('Invoice não encontrada no Asaas: inv_1')
      )
    ).toBe(false);
  });
});
