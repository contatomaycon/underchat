import 'reflect-metadata';

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

import { NfseWebhookUseCase } from '@core/useCases/webhook/NfseWebhook.useCase';

describe('NfseWebhookUseCase', () => {
  it('publishes nfse webhook payload to asaas nfse topic', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaServiceQueueService = {
      asaasNfseWebhook: jest.fn(() => 'topic.nfse'),
    };
    const useCase = new NfseWebhookUseCase(
      streamProducerService as never,
      kafkaServiceQueueService as never
    );

    const input = { invoice: { id: 'inv-1' } } as never;

    await expect(useCase.execute(input)).resolves.toBeUndefined();
    expect(kafkaServiceQueueService.asaasNfseWebhook).toHaveBeenCalled();
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'topic.nfse',
      input,
      'inv-1'
    );
  });
});
