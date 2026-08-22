import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'operation-1'),
}));

jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));
jest.mock('@core/services/account.service', () => ({
  AccountService: class {},
}));
jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/services/centrifugo.service', () => ({
  CentrifugoService: class {},
}));
jest.mock('@core/services/workerGrpcClient.service', () => ({
  WorkerGrpcClientService: class {},
}));
jest.mock('@core/services/workerLifecycleQueue.service', () => ({
  WorkerLifecycleQueueService: class {},
}));

import { EWorkerAction } from '@core/common/enums/EWorkerAction';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ChannelRecreatorUseCase } from '@core/useCases/config/ChannelRecreator.useCase';
import type { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';

const makeWorkerSnapshot = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  worker_id: 'worker-1',
  name: 'Channel',
  account_id: 'acc-1',
  server_id: 'srv-1',
  worker_status_id: EWorkerStatus.online,
  worker_type_id: EWorkerType.baileys,
  lifecycle_operation_id: null,
  deleted_at: null,
  created_at: null,
  updated_at: null,
  container_id: null,
  last_connection_check_at: null,
  ...overrides,
});

const makeRecreateJournalMessage = (
  overrides: Partial<IWorkerLifecycleQueueMessage> = {}
): IWorkerLifecycleQueueMessage => ({
  request_id: 'request-existing',
  operation_id: 'operation-existing',
  action: 'recreate',
  worker_id: 'worker-1',
  account_id: 'acc-1',
  server_id: 'srv-1',
  worker_type_id: EWorkerType.baileys,
  worker_status_id: EWorkerStatus.recreating,
  source: 'config_recreate',
  previous_worker_status_id: EWorkerStatus.online,
  requested_at: '2026-07-31T12:00:00.000Z',
  ...overrides,
});

describe('ChannelRecreatorUseCase', () => {
  it('throws when worker balancer is not found', async () => {
    const workerService = { updateWorkerById: jest.fn() };
    const accountService = { existsAccountById: jest.fn() };
    const configService = { viewChannelContext: jest.fn(async () => null) };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );
  });

  it('throws when account does not exist', async () => {
    const workerService = { updateWorkerById: jest.fn() };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = { publishSub: jest.fn(), publish: jest.fn() };
    const workerGrpcClientService = { recreateWorker: jest.fn() };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'account_not_found'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
  });

  it('uses the primary snapshot without requiring legacy balancer data', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => false) };
    const configService = {
      existsActiveAccountByIdConsistent: jest.fn(async () => true),
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => null),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      {
        prepare: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      reason: 'recreate_queued',
      account_id: 'acc-1',
      server_id: 'srv-1',
    });

    expect(
      configService.existsActiveAccountByIdConsistent
    ).toHaveBeenCalledWith('acc-1');
    expect(accountService.existsAccountById).not.toHaveBeenCalled();
    expect(configService.viewChannelBalancer).not.toHaveBeenCalled();
  });

  it('preserves the channel recreate claim when lifecycle enqueue fails', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
      publish: jest.fn(async () => undefined),
    };
    const workerGrpcClientService = {
      recreateWorker: jest.fn(async () => {
        throw new Error('grpc-fail');
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => {
        throw new Error('kafka-fail');
      }),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);
    const onLifecycleEnqueued = jest.fn();

    await expect(
      useCase.execute(t as never, 'worker-1', undefined, {
        onLifecycleEnqueued,
      })
    ).rejects.toThrow('kafka-fail');

    expect(onLifecycleEnqueued).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publish).not.toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('never clears a prepared channel operation after Kafka failure', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => {
        throw new Error('kafka-fail');
      }),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).rejects.toThrow('kafka-fail');

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(3);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
    expect(centrifugoService.publish).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
    expect(centrifugoService.publishSub).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ worker_status_id: EWorkerStatus.error })
    );
  });

  it('recreates channel successfully', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerGrpcClientService = {
      recreateWorker: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(
        async (_message: IWorkerLifecycleQueueMessage): Promise<void> =>
          undefined
      ),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);
    const onLifecycleEnqueued = jest.fn(() => {
      expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    });

    await expect(
      useCase.execute(t as never, 'worker-1', undefined, {
        onLifecycleEnqueued,
      })
    ).resolves.toMatchObject({
      code: 202,
      queued: true,
      worker_id: 'worker-1',
      worker_status_id: EWorkerStatus.recreating,
    });
    expect(onLifecycleEnqueued).toHaveBeenCalledTimes(1);

    const expectedPayload = {
      action: EWorkerAction.recreate,
      worker_id: 'worker-1',
      server_id: 'srv-1',
      account_id: 'acc-1',
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: expect.any(String),
      previous_worker_status_id: EWorkerStatus.online,
    };
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: expect.any(String),
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(centrifugoService.publishSub).toHaveBeenCalledWith(
      'worker:account#acc-1',
      expect.objectContaining(expectedPayload)
    );
    expect(centrifugoService.publish).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining(expectedPayload)
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: EWorkerAction.recreate,
        worker_id: 'worker-1',
        account_id: 'acc-1',
        server_id: 'srv-1',
        operation_id: expect.any(String),
      })
    );
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(centrifugoService.publish.mock.invocationCallOrder[0]);
  });

  it('persists a caller-reserved lifecycle identity before publishing it', async () => {
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot()
        ),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).resolves.toMatchObject({
      queued: true,
      operation_id: 'batch-operation-1',
    });

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        lifecycle_operation_id: 'batch-operation-1',
      }),
      expect.objectContaining({ lifecycle_operation_id: null })
    );
    expect(onLifecycleClaimed).toHaveBeenCalledWith(
      'batch-operation-1',
      expect.arrayContaining([
        expect.objectContaining({
          operation_id: 'batch-operation-1',
          worker_id: 'worker-1',
        }),
      ])
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ operation_id: 'batch-operation-1' })
    );
    expect(onLifecycleClaimed.mock.invocationCallOrder[0]).toBeLessThan(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    );
  });

  it('does not enqueue when the lifecycle marker was not persisted', async () => {
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => false);
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot()
        ),
        updateWorkerById: jest.fn(async () => false),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).rejects.toThrow('worker_not_found');
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
      }),
      {
        lifecycle_operation_id: null,
        server_id: 'srv-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
      }
    );
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('revalidates a changed row with the same immutable prepared payload after losing the first CAS', async () => {
    const initialSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      updated_at: '2026-07-31T12:00:00.000Z',
    });
    const racedSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.offline,
      updated_at: '2026-07-31T12:00:01.000Z',
    });
    const viewWorkerForMonitorConsistent = jest
      .fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(racedSnapshot);
    const updateWorkerByIdIfLifecycleMatches = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const workerLifecycleQueueService = {
      prepare: jest.fn(
        async (_message: IWorkerLifecycleQueueMessage): Promise<void> =>
          undefined
      ),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent,
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        { lifecycle_operation_id: 'batch-operation-1' }
      )
    ).resolves.toMatchObject({
      reason: 'recreate_queued',
      operation_id: 'batch-operation-1',
    });

    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledTimes(2);
    const preparedMessages = workerLifecycleQueueService.prepare.mock.calls.map(
      ([message]) => message
    );
    expect(preparedMessages[0]).toEqual(preparedMessages[1]);
    expect(preparedMessages[0]).toEqual(
      expect.objectContaining({
        operation_id: 'batch-operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenNthCalledWith(
      2,
      'acc-1',
      expect.objectContaining({
        lifecycle_operation_id: 'batch-operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: null,
        worker_status_id: EWorkerStatus.offline,
      })
    );
  });

  it('adopts the lifecycle winner when the initial database claim loses a race', async () => {
    const viewWorkerForMonitorConsistent = jest
      .fn()
      .mockResolvedValueOnce(makeWorkerSnapshot())
      .mockResolvedValue(
        makeWorkerSnapshot({
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: 'operation-winner',
        })
      );
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [
        makeRecreateJournalMessage({ operation_id: 'operation-winner' }),
      ]),
      redrivePrepared: jest.fn(async () => [
        makeRecreateJournalMessage({ operation_id: 'operation-winner' }),
      ]),
    };
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => false);
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent,
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        'trace-channel-claim-race'
      )
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_resumed',
      operation_id: 'operation-winner',
    });

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledTimes(1);
    expect(viewWorkerForMonitorConsistent).toHaveBeenCalledTimes(3);
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      'worker-1',
      'operation-winner',
      'trace-channel-claim-race'
    );
  });

  it('rejects an invalid primary snapshot before marking or enqueueing', async () => {
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot({ server_id: '' })
        ),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).rejects.toThrow('worker_not_found');

    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('returns queued when Centrifugo fails after lifecycle enqueue', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => {
        throw new Error('centrifugo unavailable');
      }),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      operation_id: 'operation-1',
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    ).toBeLessThan(centrifugoService.publishSub.mock.invocationCallOrder[0]);
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).toHaveBeenCalledTimes(1);
  });

  it('resumes the same fenced operation when a channel is already recreating', async () => {
    const updateWorkerByIdIfLifecycleMatches = jest.fn();
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [makeRecreateJournalMessage()]),
      redrivePrepared: jest.fn(async () => [makeRecreateJournalMessage()]),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot({
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: 'operation-existing',
          })
        ),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );
    const onLifecycleEnqueued = jest.fn();

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        'trace-channel-existing-operation',
        { onLifecycleEnqueued }
      )
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_resumed',
      operation_id: 'operation-existing',
      worker_status_id: EWorkerStatus.recreating,
    });

    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(onLifecycleEnqueued).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing',
      'trace-channel-existing-operation'
    );
  });

  it.each([
    ['create', 'worker_create'],
    ['activate_warm', 'worker_update'],
  ] as const)(
    'never adopts or redrives a %s journal as a channel recreation',
    async (action, source) => {
      const onLifecycleClaimed = jest.fn(async () => undefined);
      const workerLifecycleQueueService = {
        prepare: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
        loadPrepared: jest.fn(async () => [
          makeRecreateJournalMessage({ action, source }),
        ]),
        redrivePrepared: jest.fn(async () => [
          makeRecreateJournalMessage({ action, source }),
        ]),
      };
      const workerLifecycleLockService = {
        isLocked: jest.fn(async () => false),
        tryClaimRedrive: jest.fn(async () => true),
        releaseRedriveClaim: jest.fn(async () => undefined),
        withLock: jest.fn(),
      };
      const useCase = new ChannelRecreatorUseCase(
        {
          viewWorkerForMonitorConsistent: jest.fn(async () =>
            makeWorkerSnapshot({
              worker_status_id: EWorkerStatus.recreating,
              lifecycle_operation_id: 'operation-existing',
              updated_at: new Date().toISOString(),
            })
          ),
        } as never,
        { existsAccountById: jest.fn(async () => true) } as never,
        {
          viewChannelContext: jest.fn(async () => ({
            worker_id: 'worker-1',
            account_id: 'acc-1',
            worker_type_id: EWorkerType.baileys,
            worker_status_id: EWorkerStatus.recreating,
            name: 'Channel',
          })),
          viewChannelBalancer: jest.fn(async () => ({
            account_id: 'acc-1',
            server_id: 'srv-1',
          })),
        } as never,
        {
          publishSub: jest.fn(async () => undefined),
          publish: jest.fn(async () => undefined),
        } as never,
        workerLifecycleQueueService as never,
        { log: jest.fn(async () => undefined) } as never,
        workerLifecycleLockService as never
      );

      await expect(
        useCase.execute(
          jest.fn((key: string) => key) as never,
          'worker-1',
          undefined,
          {
            lifecycle_operation_id: 'batch-operation-1',
            onLifecycleClaimed,
          }
        )
      ).rejects.toThrow(
        `channel_recreate_lifecycle_conflict:operation-existing:${EWorkerStatus.recreating}`
      );

      expect(onLifecycleClaimed).not.toHaveBeenCalled();
      expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
      expect(
        workerLifecycleQueueService.redrivePrepared
      ).not.toHaveBeenCalled();
    }
  );

  it('never adopts a recreate journal whose primary identity differs from the worker fence', async () => {
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [
        makeRecreateJournalMessage({ account_id: 'different-account' }),
      ]),
      redrivePrepared: jest.fn(async () => [makeRecreateJournalMessage()]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot({
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: 'operation-existing',
            updated_at: new Date().toISOString(),
          })
        ),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).rejects.toThrow(
      `channel_recreate_lifecycle_conflict:operation-existing:${EWorkerStatus.recreating}`
    );

    expect(onLifecycleClaimed).not.toHaveBeenCalled();
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('supersedes an unlocked terminal online operation even when its recreate journal remains', async () => {
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const onlineSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date().toISOString(),
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [makeRecreateJournalMessage()]),
      redrivePrepared: jest.fn(async () => [makeRecreateJournalMessage()]),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => onlineSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'operation-1',
    });

    expect(workerLifecycleQueueService.loadPrepared).toHaveBeenCalledWith(
      'worker-1',
      'operation-existing'
    );
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        lifecycle_operation_id: 'operation-1',
        worker_status_id: EWorkerStatus.recreating,
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-existing',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('durably supersedes an unlocked terminal online orphan with the reserved bulk operation', async () => {
    const onlineSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-orphaned',
      updated_at: new Date().toISOString(),
    });
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const onLifecycleEnqueued = jest.fn();
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [
        makeRecreateJournalMessage({
          operation_id: 'operation-orphaned',
          action: 'create',
          source: 'worker_create',
        }),
      ]),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(async (_workerId, _operation, callback) =>
        callback({
          assertActive: jest.fn(),
          signal: new AbortController().signal,
        })
      ),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => onlineSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
          onLifecycleEnqueued,
        }
      )
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'batch-operation-1',
    });

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'batch-operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-orphaned',
        worker_status_id: EWorkerStatus.online,
      })
    );
    expect(onLifecycleClaimed).toHaveBeenCalledWith('batch-operation-1', [
      expect.objectContaining({
        operation_id: 'batch-operation-1',
        action: 'recreate',
        previous_worker_status_id: EWorkerStatus.online,
      }),
    ]);
    expect(onLifecycleClaimed.mock.invocationCallOrder[0]).toBeLessThan(
      workerLifecycleQueueService.publish.mock.invocationCallOrder[0]
    );
    expect(onLifecycleEnqueued).toHaveBeenCalledTimes(1);
  });

  it('rejects an incompatible journal under the immutable reserved operation before replacing it', async () => {
    const onlineSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'batch-operation-1',
      updated_at: new Date().toISOString(),
    });
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => [
        makeRecreateJournalMessage({
          operation_id: 'batch-operation-1',
          action: 'create',
          source: 'worker_create',
        }),
      ]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => onlineSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).rejects.toThrow(
      'channel_recreate_lifecycle_journal_conflict:batch-operation-1'
    );

    expect(workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(onLifecycleClaimed).not.toHaveBeenCalled();
  });

  it('keeps a durable terminal online orphan fenced while its lifecycle lock is active', async () => {
    const onlineSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-orphaned',
      updated_at: new Date().toISOString(),
    });
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => true),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(),
    };
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => onlineSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).rejects.toThrow(
      `channel_recreate_lifecycle_conflict:operation-orphaned:${EWorkerStatus.online}`
    );

    expect(workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(onLifecycleClaimed).not.toHaveBeenCalled();
  });

  it('does not redrive a fenced operation while its distributed lifecycle lock is active', async () => {
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => [
        {
          worker_id: 'worker-1',
          operation_id: 'operation-existing',
          action: 'recreate',
        },
      ]),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => true),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot({
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: 'operation-existing',
          })
        ),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.redrivePrepared).not.toHaveBeenCalled();
  });

  it('keeps a recent journal-less lifecycle fenced instead of creating a competing operation', async () => {
    const updateWorkerByIdIfLifecycleMatches = jest.fn();
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      prepare: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () =>
          makeWorkerSnapshot({
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: 'operation-existing',
            updated_at: new Date().toISOString(),
          })
        ),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(workerLifecycleLockService.tryClaimRedrive).not.toHaveBeenCalled();
    expect(
      workerLifecycleLockService.releaseRedriveClaim
    ).not.toHaveBeenCalled();
    expect(updateWorkerByIdIfLifecycleMatches).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.prepare).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('atomically supersedes a stale unlocked legacy lifecycle that has no durable journal', async () => {
    const staleSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      prepare: jest.fn(async () => undefined),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(async (_workerId, _operation, callback) =>
        callback({
          assertActive: jest.fn(),
          isActive: jest.fn(() => true),
          signal: new AbortController().signal,
        })
      ),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => staleSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'operation-1',
    });

    expect(workerLifecycleLockService.isLocked).toHaveBeenCalledWith(
      'worker-1'
    );
    expect(workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      'worker-1',
      'channel_recreate_supersede',
      expect.any(Function),
      {
        acquireTimeoutMs: 1_000,
        retryDelayMs: 100,
      }
    );
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        operation_id: 'operation-1',
        action: 'recreate',
      })
    );
    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        lifecycle_operation_id: 'operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-existing',
        worker_status_id: EWorkerStatus.recreating,
      })
    );
    expect(
      workerLifecycleQueueService.prepare.mock.invocationCallOrder[0]
    ).toBeLessThan(
      updateWorkerByIdIfLifecycleMatches.mock.invocationCallOrder[0]
    );
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-1',
        action: 'recreate',
      })
    );
  });

  it('atomically supersedes a stale online lifecycle residue without reporting the channel as missing', async () => {
    const staleSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.online,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const updateWorkerByIdIfLifecycleMatches = jest.fn(async () => true);
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      prepare: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => []),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(async (_workerId, _operation, callback) =>
        callback({
          assertActive: jest.fn(),
          isActive: jest.fn(() => true),
          signal: new AbortController().signal,
        })
      ),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => staleSnapshot),
        updateWorkerByIdIfLifecycleMatches,
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_superseded_stale_operation',
      operation_id: 'operation-1',
    });

    expect(updateWorkerByIdIfLifecycleMatches).toHaveBeenCalledWith(
      'acc-1',
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.recreating,
        lifecycle_operation_id: 'operation-1',
      }),
      expect.objectContaining({
        lifecycle_operation_id: 'operation-existing',
        worker_status_id: EWorkerStatus.online,
        updated_at: staleSnapshot.updated_at,
      })
    );
    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_id: 'operation-1',
        previous_worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('adopts an existing fenced operation for a durable bulk target without superseding it', async () => {
    const staleSnapshot = makeWorkerSnapshot({
      worker_status_id: EWorkerStatus.recreating,
      lifecycle_operation_id: 'operation-existing',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const existingJournal = [makeRecreateJournalMessage()];
    const workerLifecycleQueueService = {
      publish: jest.fn(async () => undefined),
      prepare: jest.fn(async () => undefined),
      loadPrepared: jest.fn(async () => existingJournal),
      redrivePrepared: jest.fn(async () => []),
    };
    const workerLifecycleLockService = {
      isLocked: jest.fn(async () => false),
      tryClaimRedrive: jest.fn(async () => true),
      releaseRedriveClaim: jest.fn(async () => undefined),
      withLock: jest.fn(),
    };
    const useCase = new ChannelRecreatorUseCase(
      {
        viewWorkerForMonitorConsistent: jest.fn(async () => staleSnapshot),
        updateWorkerByIdIfLifecycleMatches: jest.fn(),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.recreating,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never,
      { log: jest.fn(async () => undefined) } as never,
      workerLifecycleLockService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).resolves.toMatchObject({
      queued: true,
      reason: 'recreate_already_running',
      operation_id: 'operation-existing',
    });

    expect(onLifecycleClaimed).toHaveBeenCalledWith(
      'operation-existing',
      existingJournal
    );
    expect(workerLifecycleLockService.withLock).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('blocks official WhatsApp channel recreate', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => null),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.whatsapp,
        worker_status_id: EWorkerStatus.online,
        name: 'Official',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'whatsapp_official_runtime_action_not_supported'
    );
    expect(workerService.updateWorkerById).not.toHaveBeenCalled();
    expect(
      workerService.updateWorkerByIdIfLifecycleMatches
    ).not.toHaveBeenCalled();
    expect(configService.viewChannelBalancer).not.toHaveBeenCalled();
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
  });

  it('includes reserved recreate server slot in lifecycle message', async () => {
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerById: jest.fn(async () => true),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => true),
    };
    const accountService = { existsAccountById: jest.fn(async () => true) };
    const configService = {
      viewChannelContext: jest.fn(async () => ({
        worker_id: 'worker-1',
        account_id: 'acc-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.online,
        name: 'Channel',
      })),
      viewChannelBalancer: jest.fn(async () => ({
        account_id: 'acc-1',
        server_id: 'srv-1',
      })),
    };
    const centrifugoService = {
      publishSub: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      accountService as never,
      configService as never,
      centrifugoService as never,
      workerLifecycleQueueService as never
    );

    await useCase.execute(jest.fn() as never, 'worker-1', undefined, {
      recreate_server_slot_key: 'worker:recreate:server:srv-1:slot:0',
      recreate_server_slot_token: 'worker-1:token',
    });

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        recreate_server_slot_key: 'worker:recreate:server:srv-1:slot:0',
        recreate_server_slot_token: 'worker-1:token',
      })
    );
  });

  it('publishes the same lifecycle operation after an ambiguous database claim', async () => {
    const claimError = new Error('database response lost');
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
        throw claimError;
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(jest.fn((key: string) => key) as never, 'worker-1')
    ).rejects.toBe(claimError);

    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        operation_id: 'operation-1',
      })
    );
  });

  it('durably records and publishes an ambiguous claim only after the primary confirms its fence', async () => {
    const claimError = new Error('database response lost');
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const onLifecycleEnqueued = jest.fn();
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(makeWorkerSnapshot())
        .mockResolvedValueOnce(
          makeWorkerSnapshot({
            worker_status_id: EWorkerStatus.recreating,
            lifecycle_operation_id: 'batch-operation-1',
          })
        ),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
        throw claimError;
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
          onLifecycleEnqueued,
        }
      )
    ).resolves.toMatchObject({
      operation_id: 'batch-operation-1',
      reason: 'recreate_claim_recovered',
    });

    expect(onLifecycleClaimed).toHaveBeenCalledWith('batch-operation-1', [
      expect.objectContaining({
        operation_id: 'batch-operation-1',
        action: 'recreate',
      }),
    ]);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(onLifecycleEnqueued).toHaveBeenCalledTimes(1);
  });

  it('uses the durable target fence as confirmation when the post-claim primary read is unavailable', async () => {
    const claimError = new Error('database response lost');
    const onLifecycleClaimed = jest.fn(async () => undefined);
    const onLifecycleEnqueued = jest.fn();
    const workerService = {
      viewWorkerForMonitorConsistent: jest
        .fn()
        .mockResolvedValueOnce(makeWorkerSnapshot())
        .mockRejectedValueOnce(new Error('primary reread unavailable')),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
        throw claimError;
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
          onLifecycleEnqueued,
        }
      )
    ).resolves.toMatchObject({
      operation_id: 'batch-operation-1',
      reason: 'recreate_claim_recovered',
    });

    expect(onLifecycleClaimed).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).toHaveBeenCalledTimes(1);
    expect(onLifecycleEnqueued).toHaveBeenCalledTimes(1);
  });

  it('leaves an unconfirmed durable claim prepared for retry without publishing it', async () => {
    const claimError = new Error('database response lost');
    const onLifecycleClaimed = jest.fn(async () => {
      throw new Error('durable target fence was not confirmed');
    });
    const workerService = {
      viewWorkerForMonitorConsistent: jest.fn(async () => makeWorkerSnapshot()),
      updateWorkerByIdIfLifecycleMatches: jest.fn(async () => {
        throw claimError;
      }),
    };
    const workerLifecycleQueueService = {
      prepare: jest.fn(async () => undefined),
      publish: jest.fn(async () => undefined),
    };
    const useCase = new ChannelRecreatorUseCase(
      workerService as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      {
        viewChannelContext: jest.fn(async () => ({
          worker_id: 'worker-1',
          account_id: 'acc-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.online,
          name: 'Channel',
        })),
        viewChannelBalancer: jest.fn(async () => ({
          account_id: 'acc-1',
          server_id: 'srv-1',
        })),
      } as never,
      {
        publishSub: jest.fn(async () => undefined),
        publish: jest.fn(async () => undefined),
      } as never,
      workerLifecycleQueueService as never
    );

    await expect(
      useCase.execute(
        jest.fn((key: string) => key) as never,
        'worker-1',
        undefined,
        {
          lifecycle_operation_id: 'batch-operation-1',
          onLifecycleClaimed,
        }
      )
    ).rejects.toThrow(
      'Channel recreate lifecycle claim could not be durably confirmed'
    );

    expect(workerLifecycleQueueService.prepare).toHaveBeenCalledTimes(1);
    expect(workerLifecycleQueueService.publish).not.toHaveBeenCalled();
    expect(onLifecycleClaimed).toHaveBeenCalledTimes(1);
  });
});
