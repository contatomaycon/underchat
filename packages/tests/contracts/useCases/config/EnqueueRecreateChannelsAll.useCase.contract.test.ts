import 'reflect-metadata';

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

import { EnqueueRecreateChannelsAllUseCase } from '@core/useCases/config/EnqueueRecreateChannelsAll.useCase';

describe('EnqueueRecreateChannelsAllUseCase', () => {
  it('enqueues recreate-all payload to kafka topic', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaServiceQueueService = {
      configChannelsRecreateAll: jest.fn(() => 'topic-config-recreate-all'),
    };
    const useCase = new EnqueueRecreateChannelsAllUseCase(
      streamProducerService as never,
      kafkaServiceQueueService as never
    );

    await expect(
      useCase.execute('acc-1', { server_id: 'srv-1' } as never)
    ).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'topic-config-recreate-all',
      {
        account_id: 'acc-1',
        server_id: 'srv-1',
      },
      'acc-1'
    );
  });
});
