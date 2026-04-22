import 'reflect-metadata';

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

import { InvoiceWebhookUseCase } from '@core/useCases/webhook/InvoiceWebhook.useCase';

describe('InvoiceWebhookUseCase', () => {
  it('publishes invoice webhook payload to asaas invoice topic', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaServiceQueueService = {
      asaasInvoiceWebhook: jest.fn(() => 'topic.invoice'),
    };
    const useCase = new InvoiceWebhookUseCase(
      streamProducerService as never,
      kafkaServiceQueueService as never
    );

    const input = { payment: { id: 'pay-1' } } as never;

    await expect(useCase.execute(input)).resolves.toBeUndefined();
    expect(kafkaServiceQueueService.asaasInvoiceWebhook).toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'topic.invoice',
      input,
      'pay-1'
    );
  });
});
