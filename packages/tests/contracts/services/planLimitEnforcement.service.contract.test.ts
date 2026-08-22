import 'reflect-metadata';

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn) => fn()),
}));

import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

describe('PlanLimitEnforcementService', () => {
  const makeService = (
    dbRw: object = {},
    userSessionInvalidationService: object = {},
    workerLifecycleQueueService: object = {},
    centrifugoService: object = {}
  ) =>
    new PlanLimitEnforcementService(
      dbRw as never,
      {} as never,
      userSessionInvalidationService as never,
      workerLifecycleQueueService as never,
      centrifugoService as never
    );

  const t = ((key: string, params?: Record<string, unknown>) => {
    if (key.startsWith('plan_limit_resource_')) {
      return key.replace('plan_limit_resource_', '');
    }

    if (key === 'plan_limit_activate_exceeded') {
      return `limit:${params?.resource}:${params?.limit}:${params?.active}:${params?.available}`;
    }

    return key;
  }) as never;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks only resources with active usage above the allowed limit', async () => {
    const service = makeService();
    jest.spyOn(console, 'info').mockImplementation();
    const getUsage = jest.fn(async (_accountId: string, resource: string) => {
      const usage = {
        user: { allowed: 1, active: 3, available: 0, planIsActive: true },
        worker: { allowed: 1, active: 1, available: 0, planIsActive: true },
        chatbot: { allowed: 2, active: 0, available: 2, planIsActive: true },
        role: { allowed: 2, active: 4, available: 0, planIsActive: true },
        ai_agent: { allowed: 1, active: 1, available: 0, planIsActive: true },
      } as const;

      return usage[resource as keyof typeof usage];
    });
    const blockExcess = jest.fn(
      async (_accountId: string, _resource: string, excess: number) => excess
    );

    (service as any).getUsage = getUsage;
    (service as any).blockExcess = blockExcess;

    await service.enforceAccount('acc-1');

    expect(blockExcess).toHaveBeenCalledTimes(2);
    expect(blockExcess).toHaveBeenCalledWith('acc-1', 'user', 2);
    expect(blockExcess).toHaveBeenCalledWith('acc-1', 'role', 2);
  });

  it('reports unresolved excess when not enough candidates can be blocked', async () => {
    const service = makeService();
    jest.spyOn(console, 'info').mockImplementation();
    (service as any).getUsage = jest.fn(
      async (_accountId: string, resource: string) => ({
        allowed: resource === 'user' ? 1 : 10,
        active: resource === 'user' ? 3 : 0,
        available: resource === 'user' ? 0 : 10,
        planIsActive: true,
      })
    );
    (service as any).blockExcess = jest.fn(async () => 1);

    await expect(service.enforceAccount('acc-1')).rejects.toThrow(
      'plan_limit_unresolved_excess: user: excess=2, blocked=1'
    );
  });

  it('denies activation with the normalized limit message when no slot is available', async () => {
    const service = makeService();
    (service as any).getUsage = jest.fn(async () => ({
      allowed: 10,
      active: 10,
      available: 0,
      planIsActive: true,
    }));

    await expect(service.ensureCanActivate(t, 'acc-1', 'user')).rejects.toThrow(
      'limit:user:10:10:0'
    );
  });

  it('continues processing due accounts after a single account failure', async () => {
    const service = makeService();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const enforceAccountWithCheckpoint = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    (service as any).listDueAccountIds = jest.fn(async () => [
      'acc-1',
      'acc-2',
    ]);
    (service as any).enforceAccountWithCheckpoint =
      enforceAccountWithCheckpoint;

    await expect(service.enforceDueAccounts()).resolves.toBeUndefined();

    expect(enforceAccountWithCheckpoint).toHaveBeenCalledTimes(2);
    expect(enforceAccountWithCheckpoint).toHaveBeenNthCalledWith(1, 'acc-1');
    expect(enforceAccountWithCheckpoint).toHaveBeenNthCalledWith(2, 'acc-2');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not query due accounts when the requested batch is empty', async () => {
    const execute = jest.fn();
    const service = makeService({ execute });

    await expect(service.listDueAccountIds(0)).resolves.toEqual([]);

    expect(execute).not.toHaveBeenCalled();
  });

  it('uses one authoritative primary query for allowed and active usage', async () => {
    const execute = jest.fn(async () => ({
      rows: [{ allowed: '2', active: '2', plan_is_active: true }],
    }));
    const service = makeService({ execute });

    await expect(service.getUsage('acc-1', 'worker')).resolves.toEqual({
      allowed: 2,
      active: 2,
      available: 0,
      planIsActive: true,
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('abstains from automatic enforcement when the current plan is inactive', async () => {
    const service = makeService();
    jest.spyOn(console, 'info').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const blockExcess = jest.fn();
    (service as any).getUsage = jest.fn(async () => ({
      allowed: 0,
      active: 2,
      available: 0,
      planIsActive: false,
    }));
    (service as any).blockExcess = blockExcess;

    await expect(service.enforceAccount('acc-1')).resolves.toBeUndefined();

    expect(blockExcess).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Plan limit enforcement abstained because plan is inactive',
      expect.objectContaining({
        account_id: 'acc-1',
        allowed: 0,
        active: 2,
        excess: 2,
      })
    );
  });

  it('revalidates usage and avoids blocking after the account reaches its limit', async () => {
    const service = makeService();
    jest.spyOn(console, 'info').mockImplementation();
    const blockNextCandidate = jest.fn(async () => true);
    let userReads = 0;
    (service as any).getUsage = jest.fn(
      async (_accountId: string, resource: string) => {
        if (resource !== 'user') {
          return {
            allowed: 1,
            active: 1,
            available: 0,
            planIsActive: true,
          };
        }
        userReads += 1;
        return userReads === 1
          ? {
              allowed: 1,
              active: 2,
              available: 0,
              planIsActive: true,
            }
          : {
              allowed: 2,
              active: 2,
              available: 0,
              planIsActive: true,
            };
      }
    );
    (service as any).blockNextCandidate = blockNextCandidate;

    await expect(service.enforceAccount('acc-1')).resolves.toBeUndefined();

    expect(userReads).toBe(3);
    expect(blockNextCandidate).not.toHaveBeenCalled();
  });

  it('revalidates every candidate instead of blocking the initial excess in bulk', async () => {
    const service = makeService();
    jest.spyOn(console, 'info').mockImplementation();
    (service as any).getUsage = jest.fn(async () => ({
      allowed: 1,
      active: 3,
      available: 0,
      planIsActive: true,
    }));
    const blockNextCandidate = jest.fn(async () => true);
    (service as any).blockNextCandidate = blockNextCandidate;

    await expect(
      (service as any).blockExcess('acc-1', 'worker', 2)
    ).resolves.toBe(2);

    expect((service as any).getUsage).toHaveBeenCalledTimes(2);
    expect(blockNextCandidate).toHaveBeenCalledTimes(2);
  });

  it('abstains inside the database lock when the excess disappeared', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ allowed: 2, active: 2, plan_is_active: true }],
      });
    const transaction = jest.fn(async (callback: (tx: object) => unknown) =>
      callback({ execute })
    );
    const service = makeService({ transaction });
    jest.spyOn(console, 'info').mockImplementation();
    const update = jest.fn(async () => true);

    await expect(
      (service as any).executeBlockCas('acc-1', 'worker', true, update)
    ).resolves.toBe(false);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });

  it('records an error without advancing last_checked_at', async () => {
    const insertedValues: Array<Record<string, unknown>> = [];
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const dbRw = {
      insert: jest.fn(() => ({
        values: jest.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            onConflictDoUpdate: jest.fn(() => ({ execute })),
          };
        }),
      })),
    };
    const service = makeService(dbRw);
    (service as any).enforceAccount = jest.fn(async () => {
      throw new Error('boom');
    });

    await expect(service.enforceAccountWithCheckpoint('acc-1')).rejects.toThrow(
      'boom'
    );

    expect(insertedValues).toHaveLength(2);
    expect(insertedValues[1]).toEqual(
      expect.objectContaining({ account_id: 'acc-1', last_error: 'boom' })
    );
    expect(insertedValues[1]).not.toHaveProperty('last_checked_at');
  });

  it('rejects manual blocking for Master and Administrator users', async () => {
    const service = makeService();
    (service as any).isProtectedUser = jest.fn(async () => true);
    (service as any).blockUserUnlocked = jest.fn(async () => true);

    await expect(service.blockUser(t, 'acc-1', 'user-1')).rejects.toThrow(
      'cannot_block_system_user'
    );

    expect((service as any).blockUserUnlocked).not.toHaveBeenCalled();
  });

  it('keeps protected users out of automatic blocking', async () => {
    const dbRw = { update: jest.fn() };
    const service = makeService(dbRw);
    (service as any).getUserStatus = jest.fn(async () => 'active');
    (service as any).isProtectedUser = jest.fn(async () => true);

    await expect(
      (service as any).blockUserUnlocked('acc-1', 'user-1')
    ).resolves.toBe(false);

    expect(dbRw.update).not.toHaveBeenCalled();
  });

  it('unblocks protected users without applying the plan limit', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const dbRw = {
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({ execute })),
        })),
      })),
    };
    const service = makeService(dbRw);
    const ensureCanActivateUnlocked = jest.fn();
    (service as any).getUserStatus = jest.fn(async () => 'blocked');
    (service as any).isProtectedUser = jest.fn(async () => true);
    (service as any).ensureCanActivateUnlocked = ensureCanActivateUnlocked;

    await expect(service.unblockUser(t, 'acc-1', 'user-1')).resolves.toBe(true);

    expect(ensureCanActivateUnlocked).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('preserves the provider session when a plan block removes the runtime', () => {
    const service = makeService();

    const message = (service as any).buildWorkerCleanupMessage(
      {
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: 'worker-type-1',
        worker_status_id: 'online',
        lifecycle_operation_id: null,
        updated_at: '2026-07-27T20:00:00.000Z',
      },
      'operation-1'
    );

    expect(message).toEqual(
      expect.objectContaining({
        source: 'plan_limit_enforcement',
        remove_session: false,
        remove_volume: false,
      })
    );
  });

  it('restores an official worker with an active Meta connection as online', async () => {
    const execute = jest.fn(async () => [{ id: 'connection-1' }]);
    const dbRw = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ execute })),
          })),
        })),
      })),
    };
    const service = makeService(dbRw);

    await expect(
      (service as any).resolveWorkerStatusAfterPlanUnblock({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.whatsapp,
      })
    ).resolves.toBe(EWorkerStatus.online);
  });

  it('persists and publishes the provider-aware status when unblocking a worker', async () => {
    const execute = jest.fn(async () => ({ rowCount: 1 }));
    const set = jest.fn(() => ({
      where: jest.fn(() => ({ execute })),
    }));
    const service = makeService({
      update: jest.fn(() => ({ set })),
    });
    (service as any).getWorker = jest.fn(async () => ({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: null,
      worker_type_id: EWorkerType.whatsapp,
      worker_status_id: EWorkerStatus.blocked,
      lifecycle_operation_id: null,
      updated_at: '2026-08-12T16:43:50.859Z',
    }));
    (service as any).ensureCanActivateUnlocked = jest.fn(async () => undefined);
    (service as any).resolveWorkerStatusAfterPlanUnblock = jest.fn(
      async () => EWorkerStatus.online
    );
    (service as any).publishWorkerStatus = jest.fn(async () => undefined);

    await expect(
      service.unblockWorker(t, 'account-1', 'worker-1')
    ).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_status_id: EWorkerStatus.online,
        lifecycle_operation_id: null,
      })
    );
    expect((service as any).publishWorkerStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        worker_id: 'worker-1',
        worker_status_id: EWorkerStatus.online,
      })
    );
  });

  it('keeps an official worker offline when no active Meta connection exists', async () => {
    const execute = jest.fn(async () => []);
    const dbRw = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ execute })),
          })),
        })),
      })),
    };
    const service = makeService(dbRw);

    await expect(
      (service as any).resolveWorkerStatusAfterPlanUnblock({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.whatsapp,
      })
    ).resolves.toBe(EWorkerStatus.offline);
  });

  it('keeps the pairing-ready status for managed WhatsApp providers', async () => {
    const dbRw = { select: jest.fn() };
    const service = makeService(dbRw);

    await expect(
      (service as any).resolveWorkerStatusAfterPlanUnblock({
        worker_id: 'worker-1',
        worker_type_id: EWorkerType.baileys,
      })
    ).resolves.toBe(EWorkerStatus.disponible);

    expect(dbRw.select).not.toHaveBeenCalled();
  });
});
