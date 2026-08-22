import 'reflect-metadata';

import {
  acquireReboundAuxiliaryRuntimeLease,
  AuxiliaryRuntimeLeaseRaceError,
  UnrecoverableAuxiliaryRuntimeEventError,
} from '@core/consumer/auxiliaryRuntimeRebind';

const event = () => ({
  account_id: 'account-1',
  worker_id: 'worker-1',
  event_id: 'event-1',
  source_provider: 'baileys',
  runtime_generation: 7,
  connection_epoch: 'epoch-7',
});

describe('acquireReboundAuxiliaryRuntimeLease lifecycle admission', () => {
  it('rebinds only generation and epoch from an active admission state', async () => {
    const data = event();
    const lease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => true),
    };
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'active' as const,
        fence: {
          worker_id: 'worker-1',
          source_provider: 'baileys' as const,
          runtime_generation: 8,
          connection_epoch: 'epoch-8',
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: 2,
        },
      })),
      acquireEffectLease: jest.fn(async () => lease),
    };

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        data,
        runtimeFence as never,
        () => true
      )
    ).resolves.toBe(lease);
    expect(data).toEqual({
      account_id: 'account-1',
      worker_id: 'worker-1',
      event_id: 'event-1',
      source_provider: 'baileys',
      runtime_generation: 8,
      connection_epoch: 'epoch-8',
    });
  });

  it.each(['missing', 'invalid'] as const)(
    'keeps %s admission fail-closed without authoritative recovery',
    async (state) => {
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({ state })),
        acquireEffectLease: jest.fn(),
      };

      await expect(
        acquireReboundAuxiliaryRuntimeLease(
          event(),
          runtimeFence as never,
          () => true
        )
      ).rejects.toMatchObject({
        name: 'AuxiliaryRuntimeLeaseRaceError',
        reason: 'auxiliary_runtime_lease_race',
        detail: 'runtime_rotated',
      });
      expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
    }
  );

  it.each(['missing', 'invalid'] as const)(
    'uses authoritative recovery for a %s Redis admission',
    async (state) => {
      const data = event();
      const lease = {
        assertOwned: jest.fn(),
        release: jest.fn(async () => undefined),
      };
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({ state })),
        acquireEffectLease: jest.fn(),
      };
      const recover = jest.fn(async () => ({
        lease,
        worker_id: 'worker-1',
        source_provider: 'baileys',
        runtime_generation: 9,
        connection_epoch: 'epoch-9',
      }));

      await expect(
        acquireReboundAuxiliaryRuntimeLease(
          data,
          runtimeFence as never,
          () => true,
          undefined,
          recover
        )
      ).resolves.toBe(lease);
      expect(recover).toHaveBeenCalledWith(data, `runtime_fence_${state}`);
      expect(data).toMatchObject({
        runtime_generation: 9,
        connection_epoch: 'epoch-9',
      });
      expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
    }
  );

  it('keeps only an explicit activating admission transient', async () => {
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'activating' as const,
      })),
      acquireEffectLease: jest.fn(),
    };

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        event(),
        runtimeFence as never,
        () => true
      )
    ).rejects.toMatchObject({
      name: 'AuxiliaryRuntimeLeaseRaceError',
      reason: 'auxiliary_runtime_lease_race',
      detail: 'runtime_activating',
    });
    expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'deleting'] as const)(
    'classifies a durable %s tombstone as terminal',
    async (state) => {
      const runtimeFence = {
        viewAdmissionState: jest.fn(async () => ({
          state,
          worker_id: 'worker-1',
        })),
        acquireEffectLease: jest.fn(),
      };

      await expect(
        acquireReboundAuxiliaryRuntimeLease(
          event(),
          runtimeFence as never,
          () => true
        )
      ).rejects.toBeInstanceOf(UnrecoverableAuxiliaryRuntimeEventError);
      expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
    }
  );

  it('classifies an event from a replaced provider as terminal', async () => {
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'active' as const,
        fence: {
          worker_id: 'worker-1',
          source_provider: 'wwebjs' as const,
          runtime_generation: 8,
          connection_epoch: 'wwebjs-epoch-8',
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: 2,
        },
      })),
      acquireEffectLease: jest.fn(),
    };

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        event(),
        runtimeFence as never,
        () => true
      )
    ).rejects.toMatchObject({
      name: 'UnrecoverableAuxiliaryRuntimeEventError',
      reason: 'auxiliary_runtime_event_unrecoverable',
      detail: 'worker_provider_mismatch',
    });
    expect(runtimeFence.acquireEffectLease).not.toHaveBeenCalled();
  });

  it('recovers a provider mismatch only with an exact authoritative lease', async () => {
    const data = event();
    const lease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => undefined),
    };
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'active' as const,
        fence: {
          worker_id: 'worker-1',
          source_provider: 'wwebjs' as const,
          runtime_generation: 8,
          connection_epoch: 'wwebjs-epoch-8',
          connection_sequence: 2,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: 2,
        },
      })),
      acquireEffectLease: jest.fn(),
    };
    const recover = jest.fn(async () => ({
      lease,
      worker_id: 'worker-1',
      source_provider: 'baileys',
      runtime_generation: 10,
      connection_epoch: 'baileys-epoch-10',
    }));

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        data,
        runtimeFence as never,
        () => true,
        undefined,
        recover
      )
    ).resolves.toBe(lease);
    expect(recover).toHaveBeenCalledWith(data, 'worker_provider_mismatch');
    expect(data).toMatchObject({
      runtime_generation: 10,
      connection_epoch: 'baileys-epoch-10',
    });
  });

  it('propagates admission-read infrastructure failure for redelivery', async () => {
    const redisFailure = new Error('redis unavailable');
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => {
        throw redisFailure;
      }),
      acquireEffectLease: jest.fn(),
    };

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        event(),
        runtimeFence as never,
        () => true
      )
    ).rejects.toBe(redisFailure);
  });

  it('re-resolves the authoritative runtime after rotation between lookup and lease acquisition', async () => {
    const data = event();
    const lease = {
      assertOwned: jest.fn(),
      release: jest.fn(async () => true),
    };
    let generation = 8;
    const runtimeFence = {
      viewAdmissionState: jest.fn(async () => ({
        state: 'active' as const,
        fence: {
          worker_id: 'worker-1',
          source_provider: 'baileys' as const,
          runtime_generation: generation,
          connection_epoch: `epoch-${generation}`,
          connection_sequence: generation,
          activated_at: Date.now(),
          state: 'active' as const,
          activation_order: generation,
        },
      })),
      acquireEffectLease: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(lease),
    };

    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        data,
        runtimeFence as never,
        () => true
      )
    ).rejects.toBeInstanceOf(AuxiliaryRuntimeLeaseRaceError);
    expect(data).toMatchObject({
      runtime_generation: 7,
      connection_epoch: 'epoch-7',
    });

    generation = 9;
    await expect(
      acquireReboundAuxiliaryRuntimeLease(
        data,
        runtimeFence as never,
        () => true
      )
    ).resolves.toBe(lease);
    expect(data).toEqual({
      account_id: 'account-1',
      worker_id: 'worker-1',
      event_id: 'event-1',
      source_provider: 'baileys',
      runtime_generation: 9,
      connection_epoch: 'epoch-9',
    });
    expect(runtimeFence.viewAdmissionState).toHaveBeenCalledTimes(2);
    expect(runtimeFence.acquireEffectLease).toHaveBeenCalledTimes(2);
  });
});
