import 'reflect-metadata';

jest.mock('@core/services/streamProducer.service', () => ({
  StreamProducerService: class {},
}));
jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class {},
}));

import { EnqueueRecreateChannelsAllUseCase } from '@core/useCases/config/EnqueueRecreateChannelsAll.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('EnqueueRecreateChannelsAllUseCase', () => {
  it('enqueues recreate-all payload with online status by default', async () => {
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
      useCase.execute('acc-1', {
        account: 'filtered-account',
        name: 'Channel',
        number: '5511999999999',
      })
    ).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'topic-config-recreate-all',
      {
        account_id: 'acc-1',
        status: EWorkerStatus.online,
        type: undefined,
        account: 'filtered-account',
        name: 'Channel',
        number: '5511999999999',
      },
      'acc-1'
    );
  });

  it('preserves an explicit recreate-all status filter', async () => {
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
      useCase.execute('acc-1', {
        status: EWorkerStatus.error,
        type: EWorkerType.baileys,
      })
    ).resolves.toBeUndefined();

    expect(streamProducerService.send).toHaveBeenCalledWith(
      'topic-config-recreate-all',
      {
        account_id: 'acc-1',
        status: EWorkerStatus.error,
        type: EWorkerType.baileys,
        account: undefined,
        name: undefined,
        number: undefined,
      },
      'acc-1'
    );
  });
});
