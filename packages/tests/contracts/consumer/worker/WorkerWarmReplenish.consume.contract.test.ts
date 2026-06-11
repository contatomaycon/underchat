import 'reflect-metadata';

jest.mock('@core/common/functions/commitOffset', () => ({
  commitOffset: jest.fn(async () => undefined),
}));

jest.mock('@core/common/functions/connectConsumer', () => ({
  connectConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/createConsumer', () => ({
  createConsumer: jest.fn(),
}));

jest.mock('@core/common/functions/ensureKafkaTopic', () => ({
  ensureKafkaTopic: jest.fn(async () => undefined),
}));

jest.mock('@core/plugins/kafkaStreams', () => ({}));

jest.mock('@core/services/kafkaServiceQueue.service', () => ({
  KafkaServiceQueueService: class KafkaServiceQueueService {},
}));

jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class WorkerGrpcClientService {},
}));

jest.mock('@core/services/workerWarmPoolSettings.service', () => ({
  WorkerWarmPoolSettingsService: class WorkerWarmPoolSettingsService {},
}));

import { WorkerWarmReplenishConsume } from '@core/consumer/worker/WorkerWarmReplenish.consume';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { commitOffset } from '@core/common/functions/commitOffset';
import { createConsumer } from '@core/common/functions/createConsumer';

describe('WorkerWarmReplenishConsume', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeSut(warmupEnabled: boolean) {
    const handlers: Record<string, (message: any) => Promise<void>> = {};
    const kafkaConsumer: {
      on: jest.Mock;
      unsubscribe: jest.Mock;
      disconnect: jest.Mock;
    } = {
      on: jest.fn(),
      unsubscribe: jest.fn(),
      disconnect: jest.fn(),
    };
    kafkaConsumer.on = jest.fn(
      (event: string, handler: (message: any) => Promise<void>) => {
        handlers[event] = handler;
        return kafkaConsumer;
      }
    );
    kafkaConsumer.disconnect = jest.fn((callback: () => void) => callback());
    (createConsumer as jest.Mock).mockReturnValue(kafkaConsumer);

    const kafkaServiceQueueService = {
      workerWarmReplenishRequest: jest.fn(
        () => 'worker.warm.replenish.request'
      ),
      getNumPartitions: jest.fn(() => 1),
      getReplicationFactor: jest.fn(() => 1),
    };
    const workerGrpcClientService = {
      createWarmWorker: jest.fn(async () => ({
        warm_pool_id: 'warm-1',
      })),
    };
    const workerWarmPoolSettingsService = {
      view: jest.fn(async () => ({
        warmup_enabled: warmupEnabled,
      })),
    };
    const sut = new WorkerWarmReplenishConsume(
      {} as never,
      kafkaServiceQueueService as never,
      workerGrpcClientService as never,
      workerWarmPoolSettingsService as never
    );

    return {
      handlers,
      kafkaConsumer,
      kafkaServiceQueueService,
      sut,
      workerGrpcClientService,
      workerWarmPoolSettingsService,
    };
  }

  it('commits replenish messages without creating containers when warmup is disabled', async () => {
    const deps = makeSut(false);

    await deps.sut.execute();
    await deps.handlers.data({
      value: Buffer.from(
        JSON.stringify({
          request_id: 'req-1',
          server_id: 'srv-1',
          worker_type_id: EWorkerType.baileys,
          reason: 'scheduled_scan',
        })
      ),
      partition: 3,
      offset: 10,
    });

    expect(deps.workerWarmPoolSettingsService.view).toHaveBeenCalledTimes(1);
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      3,
      10
    );
  });

  it('commits invalid payloads before loading settings', async () => {
    const deps = makeSut(true);

    await deps.sut.execute();
    await deps.handlers.data({
      value: Buffer.from('{}'),
      partition: 1,
      offset: 2,
    });

    expect(deps.workerWarmPoolSettingsService.view).not.toHaveBeenCalled();
    expect(
      deps.workerGrpcClientService.createWarmWorker
    ).not.toHaveBeenCalled();
    expect(commitOffset).toHaveBeenCalledWith(
      deps.kafkaConsumer,
      'worker.warm.replenish.request',
      1,
      2
    );
  });
});
