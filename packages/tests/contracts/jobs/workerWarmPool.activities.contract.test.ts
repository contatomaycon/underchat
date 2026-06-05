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

const previousWarmPoolEnabled = process.env.WARM_WORKER_POOL_ENABLED;

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

function makeActivity(
  overrides: {
    activeEntries?: IWorkerWarmPool[];
    dockerOutput?: string;
    activeCounts?: Partial<Record<EWorkerType, number>>;
  } = {}
): {
  activity: WorkerWarmPoolActivity;
  workerWarmPoolRepository: {
    releaseExpiredReservations: jest.Mock;
    listActiveByServer: jest.Mock;
    countActiveByServerAndType: jest.Mock;
    markRuntime: jest.Mock;
  };
  workerWarmPoolQueueService: {
    ensure: jest.Mock;
    publishReplenish: jest.Mock;
    publishDelete: jest.Mock;
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
    markRuntime: jest.fn(async () => true),
  };
  const workerWarmPoolQueueService = {
    ensure: jest.fn(async () => undefined),
    publishReplenish: jest.fn(async () => undefined),
    publishDelete: jest.fn(async () => undefined),
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
    sshService as never,
    passwordEncryptorService as never
  );

  return {
    activity,
    workerWarmPoolRepository,
    workerWarmPoolQueueService,
    sshService,
  };
}

describe('WorkerWarmPoolActivity', () => {
  beforeEach(() => {
    process.env.WARM_WORKER_POOL_ENABLED = 'true';
  });

  afterAll(() => {
    process.env.WARM_WORKER_POOL_ENABLED = previousWarmPoolEnabled;
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
});
