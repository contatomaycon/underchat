import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));
jest.mock('@core/repositories/worker/WorkerServerLister.repository', () => ({
  WorkerServerListerRepository: class WorkerServerListerRepository {},
}));
jest.mock('@core/repositories/worker/WorkerWarmPool.repository', () => ({
  WorkerWarmPoolRepository: class WorkerWarmPoolRepository {},
}));
jest.mock('@core/services/workerWarmPoolQueue.service', () => ({
  WorkerWarmPoolQueueService: class WorkerWarmPoolQueueService {},
}));
jest.mock('@core/services/ssh.service', () => ({
  SshService: class SshService {},
}));
jest.mock('@core/services/passwordEncryptor.service', () => ({
  PasswordEncryptorService: class PasswordEncryptorService {},
}));

import { WorkerWarmPoolActivity } from '@core/jobs/activities/workerWarmPool.activities';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { IBalanceMonitorServer } from '@core/common/interfaces/IBalanceMonitorServer';
import { IWorkerWarmPool } from '@core/common/interfaces/IWorkerWarmPool';
import { IWorkerWarmPoolSettings } from '@core/common/interfaces/IWorkerWarmPoolSettings';

function makeServer(): IBalanceMonitorServer {
  return {
    server_id: 'server-1',
    server_status_id: 'online',
    ssh_ip: '127.0.0.1',
    ssh_port: 22,
    ssh_username: 'encrypted-root',
    ssh_password: 'encrypted-password',
    web_domain: null,
    web_port: 80,
    web_protocol: 'http',
  };
}

function makeWarmPool(
  overrides: Partial<IWorkerWarmPool> = {}
): IWorkerWarmPool {
  return {
    warm_pool_id: 'warm-1',
    server_id: 'server-1',
    worker_type_id: EWorkerType.baileys,
    container_id: 'container-1',
    container_name: 'warm-warm-1',
    session_volume_name: 'warm-warm-1',
    state: EWorkerWarmPoolState.ready,
    reserved_by_worker_id: null,
    reservation_expires_at: null,
    last_health_at: new Date().toISOString(),
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSettings(
  overrides: Partial<IWorkerWarmPoolSettings> = {}
): IWorkerWarmPoolSettings {
  return {
    settings_id: 'default',
    warmup_enabled: true,
    target_ready_baileys: 2,
    target_ready_wwebjs: 2,
    target_ready_whatsmeow: 2,
    scan_interval_seconds: 30,
    reservation_ttl_seconds: 90,
    warming_stale_after_seconds: 180,
    created_at: '2026-06-05T12:00:00.000Z',
    updated_at: '2026-06-05T12:00:00.000Z',
    ...overrides,
  };
}

function makeActivity(
  overrides: {
    activeEntries?: IWorkerWarmPool[];
    dockerOutput?: string;
    activeCounts?: Partial<Record<EWorkerType, number>>;
    readyExcessEntries?: Partial<Record<EWorkerType, IWorkerWarmPool[]>>;
    publishDeleteReject?: boolean;
    settings?: Partial<IWorkerWarmPoolSettings>;
    shouldRunScan?: boolean;
  } = {}
): {
  activity: WorkerWarmPoolActivity;
  workerWarmPoolRepository: {
    releaseExpiredReservations: jest.Mock;
    listActiveByServer: jest.Mock;
    countActiveByServerAndType: jest.Mock;
    markReadyExcessAsDeleting: jest.Mock;
    restoreDeletingToReady: jest.Mock;
    markRuntime: jest.Mock;
  };
  workerWarmPoolQueueService: {
    ensure: jest.Mock;
    publishReplenish: jest.Mock;
    publishDelete: jest.Mock;
  };
  workerWarmPoolSettingsService: {
    view: jest.Mock;
    shouldRunScan: jest.Mock;
  };
  sshService: { runCommands: jest.Mock };
} {
  const workerServerListerRepository = {
    listWarmPoolEligibleBalanceServers: jest.fn(async () => [makeServer()]),
  };
  const workerWarmPoolRepository = {
    releaseExpiredReservations: jest.fn(async () => 0),
    listActiveByServer: jest.fn(async () => overrides.activeEntries ?? []),
    countActiveByServerAndType: jest.fn(
      async (_serverId: string, workerTypeId: EWorkerType) =>
        overrides.activeCounts?.[workerTypeId] ?? 2
    ),
    markReadyExcessAsDeleting: jest.fn(
      async (input: { workerTypeId: EWorkerType }) =>
        overrides.readyExcessEntries?.[input.workerTypeId] ?? []
    ),
    restoreDeletingToReady: jest.fn(async () => true),
    markRuntime: jest.fn(async () => true),
  };
  const workerWarmPoolQueueService = {
    ensure: jest.fn(async () => undefined),
    publishReplenish: jest.fn(async () => undefined),
    publishDelete: jest.fn(async () => {
      if (overrides.publishDeleteReject) {
        throw new Error('publish failed');
      }
      return undefined;
    }),
  };
  const workerWarmPoolSettingsService = {
    view: jest.fn(async () => makeSettings(overrides.settings)),
    shouldRunScan: jest.fn(async () => overrides.shouldRunScan ?? true),
  };
  const sshService = {
    runCommands: jest.fn(async () => [
      {
        output:
          overrides.dockerOutput ??
          'warm-running|true|warm-running|019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
      },
    ]),
  };
  const passwordEncryptorService = {
    decrypt: jest.fn((value: string) => value.replace('encrypted-', '')),
  };

  const activity = new WorkerWarmPoolActivity(
    workerServerListerRepository as never,
    workerWarmPoolRepository as never,
    workerWarmPoolQueueService as never,
    workerWarmPoolSettingsService as never,
    sshService as never,
    passwordEncryptorService as never
  );

  return {
    activity,
    workerWarmPoolRepository,
    workerWarmPoolQueueService,
    workerWarmPoolSettingsService,
    sshService,
  };
}

describe('WorkerWarmPoolActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reconciles active warm pool entries missing in Docker and replenishes the pool', async () => {
    const staleReady = makeWarmPool({
      warm_pool_id: 'missing-baileys',
      container_id: 'container-missing',
      container_name: 'warm-missing-baileys',
      session_volume_name: 'warm-missing-baileys',
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.ready,
    });
    const deps = makeActivity({
      activeEntries: [staleReady],
      dockerOutput:
        'warm-wwebjs|true|warm-wwebjs|019a930d-c6f6-766d-9c84-62b9c3e7d1f0',
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolRepository.markRuntime).toHaveBeenCalledWith({
      warm_pool_id: 'missing-baileys',
      state: EWorkerWarmPoolState.deleting,
      last_error: 'warm_runtime_missing_in_docker',
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: 'missing-baileys',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-missing',
        container_name: 'warm-missing-baileys',
        session_volume_name: 'warm-missing-baileys',
        remove_volume: true,
        reason: 'pool_reconcile',
      })
    );
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(2);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        reason: 'scheduled_scan',
      })
    );
  });

  it('does not reconcile a fresh warming entry that is not visible in Docker yet', async () => {
    const freshWarming = makeWarmPool({
      warm_pool_id: 'fresh-warming',
      container_name: 'warm-fresh-warming',
      session_volume_name: 'warm-fresh-warming',
      worker_type_id: EWorkerType.baileys,
      state: EWorkerWarmPoolState.warming,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const deps = makeActivity({
      activeEntries: [freshWarming],
      dockerOutput: '',
      activeCounts: {
        [EWorkerType.baileys]: 1,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolRepository.markRuntime).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishDelete
    ).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(1);
  });

  it('does not scan when automatic warmup is disabled', async () => {
    const deps = makeActivity({
      settings: {
        warmup_enabled: false,
      },
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolSettingsService.view).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolSettingsService.shouldRunScan
    ).not.toHaveBeenCalled();
    expect(deps.workerWarmPoolQueueService.ensure).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).not.toHaveBeenCalled();
  });

  it('does not scan when the configured interval has not elapsed', async () => {
    const deps = makeActivity({
      shouldRunScan: false,
    });

    await deps.activity.scan();

    expect(deps.workerWarmPoolSettingsService.shouldRunScan).toHaveBeenCalled();
    expect(deps.workerWarmPoolQueueService.ensure).not.toHaveBeenCalled();
    expect(
      deps.workerWarmPoolRepository.releaseExpiredReservations
    ).not.toHaveBeenCalled();
  });

  it('uses configured targets by worker type and accepts zero', async () => {
    const deps = makeActivity({
      dockerOutput: '',
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 1,
        target_ready_whatsmeow: 0,
      },
      activeCounts: {
        [EWorkerType.baileys]: 0,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        reason: 'scheduled_scan',
      })
    );
  });

  it('marks ready warm channels above the target as deleting and publishes delete requests', async () => {
    const excessEntries = [
      makeWarmPool({
        warm_pool_id: 'excess-1',
        container_id: 'container-excess-1',
        container_name: 'warm-excess-1',
        session_volume_name: 'warm-excess-1',
        worker_type_id: EWorkerType.baileys,
      }),
      makeWarmPool({
        warm_pool_id: 'excess-2',
        container_id: 'container-excess-2',
        container_name: 'warm-excess-2',
        session_volume_name: 'warm-excess-2',
        worker_type_id: EWorkerType.baileys,
      }),
      makeWarmPool({
        warm_pool_id: 'excess-3',
        container_id: 'container-excess-3',
        container_name: 'warm-excess-3',
        session_volume_name: 'warm-excess-3',
        worker_type_id: EWorkerType.baileys,
      }),
    ];
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 5,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: excessEntries,
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).toHaveBeenCalledWith({
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      limit: 3,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledTimes(
      3
    );
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        warm_pool_id: 'excess-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        container_id: 'container-excess-1',
        container_name: 'warm-excess-1',
        session_volume_name: 'warm-excess-1',
        remove_volume: true,
        reason: 'pool_excess',
      })
    );
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('trims all ready warm channels for a type when the target is zero', async () => {
    const deps = makeActivity({
      settings: {
        target_ready_baileys: 0,
        target_ready_wwebjs: 0,
        target_ready_whatsmeow: 0,
      },
      activeCounts: {
        [EWorkerType.baileys]: 2,
        [EWorkerType.wwebjs]: 0,
        [EWorkerType.whatsmeow]: 0,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: [
          makeWarmPool({ warm_pool_id: 'excess-1' }),
          makeWarmPool({ warm_pool_id: 'excess-2' }),
        ],
      },
    });

    await deps.activity.scan();

    expect(
      deps.workerWarmPoolRepository.markReadyExcessAsDeleting
    ).toHaveBeenCalledWith({
      serverId: 'server-1',
      workerTypeId: EWorkerType.baileys,
      limit: 2,
    });
    expect(deps.workerWarmPoolQueueService.publishDelete).toHaveBeenCalledTimes(
      2
    );
    expect(
      deps.workerWarmPoolQueueService.publishReplenish
    ).not.toHaveBeenCalled();
  });

  it('rolls back an excess warm channel when publishing the delete request fails', async () => {
    const deps = makeActivity({
      activeCounts: {
        [EWorkerType.baileys]: 3,
        [EWorkerType.wwebjs]: 2,
        [EWorkerType.whatsmeow]: 2,
      },
      readyExcessEntries: {
        [EWorkerType.baileys]: [
          makeWarmPool({
            warm_pool_id: 'excess-rollback',
            worker_type_id: EWorkerType.baileys,
          }),
        ],
      },
      publishDeleteReject: true,
    });

    await expect(deps.activity.scan()).rejects.toThrow('publish failed');

    expect(
      deps.workerWarmPoolRepository.restoreDeletingToReady
    ).toHaveBeenCalledWith('excess-rollback');
  });
});
