import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('WorkerLifecycleQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes lifecycle requests to the global topic keyed by worker_id', async () => {
    const kafkaServiceQueueService = {
      workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaService = {
      createTopics: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      kafkaServiceQueueService as never,
      streamProducerService as never,
      kafkaService as never
    );

    await sut.ensure();
    await sut.publish({
      request_id: 'request-1',
      operation_id: 'operation-1',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: true,
      remove_volume: true,
      requested_at: '2026-06-05T00:00:00.000Z',
    });

    expect(kafkaService.createTopics).toHaveBeenCalledWith(
      ['worker.lifecycle.request'],
      30,
      3
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.lifecycle.request',
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        operation_id: 'operation-1',
      }),
      'worker-1',
      []
    );
  });
});
