import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/useCases/config/ChannelRecreator.useCase', () => ({
  ChannelRecreatorUseCase: class {},
}));

import { ChannelsRecreatorAllUseCase } from '@core/useCases/config/ChannelsRecreatorAll.useCase';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { WorkerRecreateServerSlotLease } from '@core/services/workerRecreateServerSlot.service';
import { KafkaConsumerDispatchRevokedError } from '@core/common/exceptions/KafkaConsumerDispatchRevokedError';

function createSlotService(slotCount = 2) {
  const activeByServer = new Map<string, number>();
  const maxActiveByServer = new Map<string, number>();

  const decrement = (serverId: string): void => {
    activeByServer.set(
      serverId,
      Math.max(0, (activeByServer.get(serverId) ?? 0) - 1)
    );
  };

  return {
    activeByServer,
    maxActiveByServer,
    getSlotCount: jest.fn(() => slotCount),
    getReservationTtlMs: jest.fn(() => 120_000),
    buildToken: jest.fn((workerId: string) => `${workerId}:slot-token`),
    acquire: jest.fn(async (serverId: string, token: string) => {
      const active = (activeByServer.get(serverId) ?? 0) + 1;
      activeByServer.set(serverId, active);
      maxActiveByServer.set(
        serverId,
        Math.max(maxActiveByServer.get(serverId) ?? 0, active)
      );

      return {
        key: `worker:recreate:server:${serverId}:slot:${active - 1}`,
        token,
        serverId,
        slot: active - 1,
        reserved: false,
      } satisfies WorkerRecreateServerSlotLease;
    }),
    waitForRelease: jest.fn(async (lease: WorkerRecreateServerSlotLease) => {
      await Promise.resolve();
      decrement(lease.serverId);
    }),
    release: jest.fn(async (lease: WorkerRecreateServerSlotLease) => {
      decrement(lease.serverId);
    }),
  };
}

describe('ChannelsRecreatorAllUseCase', () => {
  it('throws when there are no channels to recreate', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => []),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(),
    };
    const slotService = createSlotService();
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, { account: 'acc-filter' })
    ).rejects.toThrow('no_channels_to_recreate');
    expect(
      configService.listAllNonDeletedChannelRecreateTargets
    ).toHaveBeenCalledWith({
      status: EWorkerStatus.online,
      type: undefined,
      account: 'acc-filter',
      name: undefined,
      number: undefined,
    });
    expect(channelRecreatorUseCase.execute).not.toHaveBeenCalled();
  });

  it('preserves explicit status when listing channels to recreate', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'w1', server_id: 'srv-1' },
        { worker_id: 'w2', server_id: 'srv-1' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const slotService = createSlotService();
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, {
        status: EWorkerStatus.error,
        session_storage: EWorkerSessionStorage.postgres,
        name: 'Channel',
        number: '5511999999999',
      })
    ).resolves.toEqual({
      success: 2,
      errors: 0,
    });
    expect(
      configService.listAllNonDeletedChannelRecreateTargets
    ).toHaveBeenCalledWith({
      status: EWorkerStatus.error,
      type: undefined,
      session_storage: EWorkerSessionStorage.postgres,
      account: undefined,
      name: 'Channel',
      number: '5511999999999',
    });
    expect(channelRecreatorUseCase.execute).toHaveBeenCalledWith(
      expect.any(Function),
      'w1',
      undefined,
      expect.objectContaining({
        recreate_server_slot_key: 'worker:recreate:server:srv-1:slot:0',
        recreate_server_slot_token: 'w1:slot-token',
      })
    );
  });

  it('counts fulfilled and rejected recreations', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'w1', server_id: 'srv-1' },
        { worker_id: 'w2', server_id: 'srv-1' },
        { worker_id: 'w3', server_id: 'srv-1' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(true),
    };
    const slotService = createSlotService();
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, { server_id: 'srv-1' } as never)
    ).resolves.toEqual({
      success: 2,
      errors: 1,
    });
    expect(slotService.release).toHaveBeenCalledTimes(3);
  });

  it('limits recreate scheduling to two active slots per server', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'srv-1-w1', server_id: 'srv-1' },
        { worker_id: 'srv-1-w2', server_id: 'srv-1' },
        { worker_id: 'srv-1-w3', server_id: 'srv-1' },
        { worker_id: 'srv-2-w1', server_id: 'srv-2' },
        { worker_id: 'srv-2-w2', server_id: 'srv-2' },
        { worker_id: 'srv-2-w3', server_id: 'srv-2' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(async () => true),
    };
    const slotService = createSlotService(2);
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );

    await expect(useCase.execute(jest.fn() as never, {})).resolves.toEqual({
      success: 6,
      errors: 0,
    });

    expect(slotService.maxActiveByServer.get('srv-1')).toBeLessThanOrEqual(2);
    expect(slotService.maxActiveByServer.get('srv-2')).toBeLessThanOrEqual(2);
  });

  it('passes the active Kafka assignment guard through slot acquisition and release waiting', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'w1', server_id: 'srv-1' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(
        async (
          _t: unknown,
          _workerId: string,
          _trace: unknown,
          options?: { onLifecycleEnqueued?: () => void }
        ) => {
          options?.onLifecycleEnqueued?.();
          return true;
        }
      ),
    };
    const slotService = createSlotService(1);
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );
    const assertActive = jest.fn();

    await expect(
      useCase.execute(jest.fn() as never, {}, { assertActive })
    ).resolves.toEqual({
      success: 1,
      errors: 0,
    });

    expect(slotService.acquire).toHaveBeenCalledWith('srv-1', 'w1:slot-token', {
      assertActive,
      reservation: true,
      ttlMs: 120_000,
    });
    expect(slotService.waitForRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        token: 'w1:slot-token',
      }),
      { assertActive }
    );
    expect(assertActive).toHaveBeenCalled();
  });

  it('releases an unused reservation immediately when an existing lifecycle was only resumed', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'w1', server_id: 'srv-1' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(async () => ({
        queued: true,
        reason: 'recreate_already_running',
      })),
    };
    const slotService = createSlotService(1);
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );

    await expect(useCase.execute(jest.fn() as never, {})).resolves.toEqual({
      success: 1,
      errors: 0,
    });

    expect(slotService.release).toHaveBeenCalledTimes(1);
    expect(slotService.waitForRelease).not.toHaveBeenCalled();
  });

  it('propagates assignment revocation without releasing a transferred slot', async () => {
    const configService = {
      listAllNonDeletedChannelRecreateTargets: jest.fn(async () => [
        { worker_id: 'w1', server_id: 'srv-1' },
      ]),
    };
    const channelRecreatorUseCase = {
      execute: jest.fn(
        async (
          _t: unknown,
          _workerId: string,
          _trace: unknown,
          options?: { onLifecycleEnqueued?: () => void }
        ) => {
          options?.onLifecycleEnqueued?.();
          return true;
        }
      ),
    };
    const slotService = createSlotService(1);
    const revoked = new KafkaConsumerDispatchRevokedError();
    let active = true;
    slotService.waitForRelease.mockImplementationOnce(async () => {
      active = false;
      throw revoked;
    });
    const assertActive = jest.fn(() => {
      if (!active) {
        throw revoked;
      }
    });
    const useCase = new ChannelsRecreatorAllUseCase(
      configService as never,
      channelRecreatorUseCase as never,
      slotService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, {}, { assertActive })
    ).rejects.toBe(revoked);

    expect(channelRecreatorUseCase.execute).toHaveBeenCalledTimes(1);
    expect(slotService.release).not.toHaveBeenCalled();
  });
});
