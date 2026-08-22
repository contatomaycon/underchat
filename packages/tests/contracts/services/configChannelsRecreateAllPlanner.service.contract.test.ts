import 'reflect-metadata';

import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { ConfigChannelsRecreateAllPlannerService } from '@core/services/configChannelsRecreateAllPlanner.service';

describe('ConfigChannelsRecreateAllPlannerService', () => {
  it('persists one immutable target snapshot with normalized filters', async () => {
    const targets = [
      {
        worker_id: 'worker-1',
        worker_account_id: 'worker-account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-1',
        runtime_container_id: 'container-1',
        runtime_generation: 4,
      },
      {
        worker_id: 'worker-2',
        worker_account_id: 'worker-account-2',
        server_id: 'server-2',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.online,
        worker_container_id: 'container-2',
        runtime_container_id: 'container-2',
        runtime_generation: 8,
      },
    ];
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => targets),
    };
    const batchRepository = {
      loadExistingBatch: jest.fn(async () => null),
      createOrLoadBatch: jest.fn(async () => ({
        batchId: 'batch-1',
        created: true,
        targetCount: 2,
      })),
    };
    const planner = new ConfigChannelsRecreateAllPlannerService(
      configService as never,
      batchRepository as never
    );
    const source = {
      requestId: 'request-1',
      topic: 'config.channels.recreate.all',
      partition: 1,
      offset: 42,
      accountId: 'account-1',
    };
    const assertActive = jest.fn();

    await expect(
      planner.prepare(
        jest.fn((key: string) => key) as never,
        source,
        {
          type: EWorkerType.whatsmeow,
          session_storage: EWorkerSessionStorage.postgres,
          account: '',
          name: 'Channel',
        },
        { assertActive }
      )
    ).resolves.toEqual({
      batchId: 'batch-1',
      created: true,
      targetCount: 2,
    });

    expect(
      configService.listAllNonDeletedChannelRecreateTargets
    ).toHaveBeenCalledWith({
      status: EWorkerStatus.online,
      type: EWorkerType.whatsmeow,
      session_storage: EWorkerSessionStorage.postgres,
      account: undefined,
      name: 'Channel',
      number: undefined,
    });
    expect(batchRepository.createOrLoadBatch).toHaveBeenCalledWith(
      source,
      {
        status: EWorkerStatus.online,
        type: EWorkerType.whatsmeow,
        session_storage: EWorkerSessionStorage.postgres,
        account: undefined,
        name: 'Channel',
        number: undefined,
      },
      targets,
      'no_channels_to_recreate'
    );
    expect(assertActive).toHaveBeenCalledTimes(4);
  });

  it('durably records an empty selection so Kafka replay returns the same terminal batch', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => []),
    };
    const batchRepository = {
      loadExistingBatch: jest.fn(async () => null),
      createOrLoadBatch: jest.fn(async () => ({
        batchId: 'batch-empty',
        created: true,
        targetCount: 0,
      })),
    };
    const planner = new ConfigChannelsRecreateAllPlannerService(
      configService as never,
      batchRepository as never
    );

    await planner.prepare(
      jest.fn((key: string) => key) as never,
      {
        requestId: 'request-empty',
        topic: 'config.channels.recreate.all',
        partition: 0,
        offset: 7,
        accountId: 'account-1',
      },
      {}
    );

    expect(batchRepository.createOrLoadBatch).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'request-empty' }),
      {
        status: EWorkerStatus.online,
        type: undefined,
        account: undefined,
        name: undefined,
        number: undefined,
      },
      [],
      'no_channels_to_recreate'
    );
  });

  it('returns a replayed durable batch without taking a second worker snapshot', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(),
    };
    const batchRepository = {
      loadExistingBatch: jest.fn(async () => ({
        batchId: 'batch-existing',
        created: false,
        targetCount: 30,
      })),
      createOrLoadBatch: jest.fn(),
    };
    const planner = new ConfigChannelsRecreateAllPlannerService(
      configService as never,
      batchRepository as never
    );

    await expect(
      planner.prepare(
        jest.fn((key: string) => key) as never,
        {
          requestId: 'request-existing',
          topic: 'config.channels.recreate.all',
          partition: 2,
          offset: 99,
          accountId: 'account-1',
        },
        { type: EWorkerType.whatsmeow }
      )
    ).resolves.toEqual({
      batchId: 'batch-existing',
      created: false,
      targetCount: 30,
    });

    expect(
      configService.listAllNonDeletedChannelRecreateTargets
    ).not.toHaveBeenCalled();
    expect(batchRepository.createOrLoadBatch).not.toHaveBeenCalled();
  });
});
