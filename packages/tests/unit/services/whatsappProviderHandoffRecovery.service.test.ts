import 'reflect-metadata';
import type { Pool, PoolClient } from 'pg';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { CentrifugoService } from '@core/services/centrifugo.service';
import type { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { WhatsappProviderHandoffRecoveryService } from '@core/services/whatsappProviderHandoffRecovery.service';

const SESSION_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const HANDOFF_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';
const ORIGINAL_OPERATION = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';
const RECOVERY_OPERATION = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5e';
const ACCOUNT_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5f';
const SERVER_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60';

const claim = {
  session_id: SESSION_ID,
  handoff_id: HANDOFF_ID,
  recovery_operation_id: RECOVERY_OPERATION,
  recovery_attempt_count: 1,
};

const postgresProviderHandoffPairs = [
  {
    source: 'baileys' as const,
    sourceType: EWorkerType.baileys,
    target: 'whatsmeow' as const,
    targetType: EWorkerType.whatsmeow,
  },
  {
    source: 'baileys' as const,
    sourceType: EWorkerType.baileys,
    target: 'wwebjs' as const,
    targetType: EWorkerType.wwebjs,
  },
  {
    source: 'whatsmeow' as const,
    sourceType: EWorkerType.whatsmeow,
    target: 'baileys' as const,
    targetType: EWorkerType.baileys,
  },
  {
    source: 'whatsmeow' as const,
    sourceType: EWorkerType.whatsmeow,
    target: 'wwebjs' as const,
    targetType: EWorkerType.wwebjs,
  },
  {
    source: 'wwebjs' as const,
    sourceType: EWorkerType.wwebjs,
    target: 'baileys' as const,
    targetType: EWorkerType.baileys,
  },
  {
    source: 'wwebjs' as const,
    sourceType: EWorkerType.wwebjs,
    target: 'whatsmeow' as const,
    targetType: EWorkerType.whatsmeow,
  },
] as const;

function defaultRows() {
  return {
    worker: {
      worker_id: SESSION_ID,
      account_id: ACCOUNT_ID,
      server_id: SERVER_ID,
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.recreating,
      session_storage: EWorkerSessionStorage.postgres,
      lifecycle_operation_id: ORIGINAL_OPERATION as string | null,
      container_id: 'a'.repeat(64),
      deleted_at: null,
    },
    runtime: {
      container_id: 'a'.repeat(64),
      session_storage: EWorkerSessionStorage.postgres,
      runtime_generation: 5,
      runtime_capability_hash: 'b'.repeat(64),
      session_writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a61',
      source_provider: 'wwebjs',
      connection_activated_at: new Date().toISOString(),
      native_connection_online_acknowledged: false,
      native_connection_status_source_id:
        '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a63',
      native_connection_status_sequence: 1,
      native_connection_status: {
        provider: 'wwebjs',
        status: 'offline',
        connected: false,
        authenticated: false,
        sessionValid: false,
        qrAvailable: false,
      } as Record<string, unknown>,
      native_connection_status_lease_owner_id: null as string | null,
      native_connection_status_fencing_token: null as number | null,
    },
    lease: {
      owner_id: null as string | null,
      provider: null as string | null,
      generation: 5,
      epoch: null as string | null,
      fencing_token: 7,
      expires_at: null as string | null,
      database_now: new Date().toISOString(),
    },
    session: {
      provider: 'baileys',
      state: 'ready',
      active_revision_id: '10',
      generation: 5,
      epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a61',
      capability_hash: 'b'.repeat(64),
    },
    sourceRevision: {
      revision_id: '10',
      provider: 'baileys',
      status: 'active',
      writer_generation: 5,
      writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a61',
      capability_hash: 'b'.repeat(64),
    },
    handoff: {
      ...claim,
      lifecycle_operation_id: ORIGINAL_OPERATION,
      source_provider: 'baileys',
      target_provider: 'wwebjs',
      source_revision_id: '10',
      target_revision_id: '11',
      state: 'failed',
      recovery_state: 'dispatching',
      recovery_cleanup_required: null as boolean | null,
      recovery_from_generation: null as number | null,
    },
  };
}

function makeWwebjsRecoveryHealthyWithAttachedLifecycle(
  rows: ReturnType<typeof defaultRows>
): void {
  rows.worker.worker_type_id = EWorkerType.wwebjs;
  rows.worker.worker_status_id = EWorkerStatus.online;
  rows.worker.lifecycle_operation_id = RECOVERY_OPERATION;
  rows.worker.container_id = 'c'.repeat(64);
  rows.runtime.container_id = 'c'.repeat(64);
  rows.runtime.runtime_generation = 6;
  rows.runtime.source_provider = 'wwebjs';
  rows.runtime.native_connection_online_acknowledged = true;
  rows.runtime.native_connection_status_source_id =
    '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a63';
  rows.runtime.native_connection_status_sequence = 4;
  rows.runtime.native_connection_status = {
    provider: 'wwebjs',
    status: 'online',
    connected: true,
    authenticated: true,
    sessionValid: true,
    qrAvailable: false,
  };
  rows.runtime.native_connection_status_lease_owner_id =
    '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
  rows.runtime.native_connection_status_fencing_token = 8;
  rows.handoff.source_provider = 'wwebjs';
  rows.handoff.target_provider = 'baileys';
  rows.handoff.recovery_state = 'running';
  rows.handoff.recovery_cleanup_required = true;
  rows.handoff.recovery_from_generation = 5;
  rows.session.provider = 'wwebjs';
  rows.session.generation = 6;
  rows.sourceRevision.provider = 'wwebjs';
  rows.sourceRevision.writer_generation = 6;
  rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
  rows.lease.provider = 'wwebjs';
  rows.lease.generation = 6;
  rows.lease.epoch = rows.session.epoch;
  rows.lease.fencing_token = 8;
  rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
}

function createHarness(input?: {
  claims?: Array<Record<string, unknown>>;
  mutate?: (rows: ReturnType<typeof defaultRows>) => void;
  publishError?: Error;
  workerCasRowCount?: number;
  leaseFenceRowCount?: number;
  dispatchAckRowCount?: number;
  lifecycleLocked?: boolean;
  lifecycleLockError?: Error;
  lockAssertFailAt?: number;
  centrifugoPublishError?: Error;
}) {
  const rows = defaultRows();
  const events: string[] = [];
  input?.mutate?.(rows);
  const clientQuery = jest.fn(
    async (statement: string, _values?: readonly unknown[]) => {
      if (statement === 'COMMIT') events.push('db.commit');
      if (statement === 'ROLLBACK') events.push('db.rollback');
      if (statement.includes('FROM worker\n')) {
        return { rows: [rows.worker], rowCount: 1 };
      }
      if (statement.includes('FROM worker_runtime AS runtime')) {
        return { rows: [rows.runtime], rowCount: 1 };
      }
      if (statement.includes('FROM whatsapp_session_lease AS lease')) {
        return { rows: [rows.lease], rowCount: 1 };
      }
      if (statement.includes('FROM whatsapp_session AS session')) {
        return { rows: [rows.session], rowCount: 1 };
      }
      if (
        statement.includes('FROM whatsapp_session_revision AS source_revision')
      ) {
        return { rows: [rows.sourceRevision], rowCount: 1 };
      }
      if (statement.includes('FROM whatsapp_session_handoff AS handoff')) {
        return { rows: [rows.handoff], rowCount: 1 };
      }
      if (statement.includes('UPDATE worker')) {
        return { rows: [], rowCount: input?.workerCasRowCount ?? 1 };
      }
      if (statement.includes('UPDATE whatsapp_session_lease')) {
        return { rows: [], rowCount: input?.leaseFenceRowCount ?? 1 };
      }
      if (statement.includes('UPDATE whatsapp_session_handoff')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  );
  const client = {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient;
  const poolQuery = jest.fn(
    async (statement: string, _values?: readonly unknown[]) => {
      if (statement.includes('WITH candidates AS MATERIALIZED')) {
        return {
          rows: input?.claims ?? [claim],
          rowCount: input?.claims?.length ?? 1,
        };
      }
      if (statement.includes("SET recovery_state = 'running'")) {
        return { rows: [], rowCount: input?.dispatchAckRowCount ?? 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  );
  const pool = {
    query: poolQuery,
    connect: jest.fn(async () => {
      events.push('db.connect');
      return client;
    }),
  } as unknown as Pool;
  const lifecycleQueue = {
    prepare: jest.fn(async (message: { action: string }) => {
      events.push(`journal.prepare:${message.action}`);
    }),
    publish: jest.fn(async (message: { action: string }) => {
      events.push(`journal.publish:${message.action}`);
      if (input?.publishError) throw input.publishError;
    }),
  } as unknown as WorkerLifecycleQueueService;
  let lockAssertCount = 0;
  const lockAssertActive = jest.fn(() => {
    lockAssertCount += 1;
    if (input?.lockAssertFailAt === lockAssertCount) {
      throw new Error('worker_lifecycle_lock_lost');
    }
  });
  const workerLifecycleLockService = {
    withLock: jest.fn(
      async (
        workerId: string,
        operation: string,
        callback: (context: {
          signal: AbortSignal;
          assertActive: () => void;
        }) => Promise<unknown>
      ) => {
        events.push('lock.acquire.attempt');
        if (input?.lifecycleLockError) throw input.lifecycleLockError;
        if (input?.lifecycleLocked) {
          throw new Error(
            `Worker lifecycle lock timeout for ${workerId} (${operation})`
          );
        }
        events.push('lock.acquired');
        try {
          return await callback({
            signal: new AbortController().signal,
            assertActive: lockAssertActive,
          });
        } finally {
          events.push('lock.released');
        }
      }
    ),
  };
  const centrifugoService = {
    publishSubImmediate: jest.fn(async () => {
      events.push('centrifugo.publish');
      if (input?.centrifugoPublishError) {
        throw input.centrifugoPublishError;
      }
      return {};
    }),
  } as unknown as CentrifugoService;
  const service = new WhatsappProviderHandoffRecoveryService(
    pool,
    lifecycleQueue,
    workerLifecycleLockService as never,
    centrifugoService,
    { retryDelayMs: 1_000, runningProbeMs: 5_000 }
  );
  return {
    service,
    pool,
    poolQuery,
    client,
    clientQuery,
    lifecycleQueue,
    workerLifecycleLockService,
    centrifugoService,
    lockAssertActive,
    events,
  };
}

describe('WhatsappProviderHandoffRecoveryService', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('claims a bounded durable batch while reserving target leases for their current owner', async () => {
    const harness = createHarness({ claims: [] });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 0,
      dispatched: 0,
      skipped: false,
    });

    const [statement, values] = harness.poolQuery.mock.calls[0];
    expect(String(statement)).toContain('FOR UPDATE OF handoff SKIP LOCKED');
    expect(String(statement)).toContain(
      'lease.expires_at <= statement_timestamp()'
    );
    expect(String(statement)).toContain(
      'lease.provider = handoff.source_provider'
    );
    expect(String(statement)).toContain(
      "handoff.recovery_state IN ('pending', 'dispatching', 'running')"
    );
    expect(values).toEqual([20, expect.any(String), 2 * 60_000]);
    expect(harness.pool.connect).not.toHaveBeenCalled();
  });

  it('defers a claimed recovery while its lifecycle handler still owns the worker lock', async () => {
    const harness = createHarness({ lifecycleLocked: true });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      deferred: 1,
      dispatched: 0,
      completed: 0,
      errors: 0,
    });

    expect(harness.pool.connect).not.toHaveBeenCalled();
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(harness.workerLifecycleLockService.withLock).toHaveBeenCalledWith(
      SESSION_ID,
      'whatsapp_provider_handoff_recovery',
      expect.any(Function),
      {
        ttlMs: 30_000,
        acquireTimeoutMs: 1,
        retryDelayMs: 1,
        heartbeatIntervalMs: 10_000,
      }
    );
    expect(harness.events).toEqual(['lock.acquire.attempt']);
    const deferred = harness.poolQuery.mock.calls.find(
      ([statement, values]) =>
        String(statement).includes('recovery_claim_token = NULL') &&
        values?.[4] === 'worker_lifecycle_lock_active'
    );
    expect(deferred?.[1]).toEqual([
      SESSION_ID,
      HANDOFF_ID,
      expect.any(String),
      5_000,
      'worker_lifecycle_lock_active',
      RECOVERY_OPERATION,
    ]);
  });

  it('fails closed when the lifecycle lock cannot be inspected', async () => {
    const harness = createHarness({
      lifecycleLockError: new Error('redis unavailable'),
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      deferred: 0,
      dispatched: 0,
      completed: 0,
      errors: 1,
    });

    expect(harness.pool.connect).not.toHaveBeenCalled();
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(harness.lifecycleQueue.publish).not.toHaveBeenCalled();
    expect(harness.events).toEqual(['lock.acquire.attempt']);
    expect(
      harness.poolQuery.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes("SET recovery_state = 'pending'") &&
          values?.[4] === 'error'
      )
    ).toBe(true);
  });

  it('CASes target to source and journals cleanup before the source recreate', async () => {
    const harness = createHarness();

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      dispatched: 1,
      completed: 0,
      errors: 0,
    });

    const workerCas = harness.clientQuery.mock.calls.find(([statement]) =>
      String(statement).includes('SET worker_type_id = $2::uuid')
    );
    expect(workerCas?.[1]).toEqual([
      SESSION_ID,
      EWorkerType.baileys,
      EWorkerStatus.recreating,
      RECOVERY_OPERATION,
      ACCOUNT_ID,
      SERVER_ID,
      EWorkerType.wwebjs,
      ORIGINAL_OPERATION,
    ]);

    const prepared = (
      harness.lifecycleQueue.prepare as jest.Mock
    ).mock.calls.map(([message]) => message);
    expect(prepared).toHaveLength(2);
    expect(prepared[0]).toMatchObject({
      action: 'recreate',
      operation_id: RECOVERY_OPERATION,
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
    });
    expect(prepared[1]).toMatchObject({
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.wwebjs,
    });

    const published = (
      harness.lifecycleQueue.publish as jest.Mock
    ).mock.calls.map(([message]) => message.action);
    expect(published).toEqual(['cleanup_previous_runtime', 'recreate']);
    expect(
      harness.poolQuery.mock.calls.some(([statement]) =>
        String(statement).includes("SET recovery_state = 'running'")
      )
    ).toBe(true);
    expect(harness.events).toEqual([
      'lock.acquire.attempt',
      'lock.acquired',
      'db.connect',
      'db.commit',
      'lock.released',
      'journal.prepare:recreate',
      'journal.prepare:cleanup_previous_runtime',
      'journal.publish:cleanup_previous_runtime',
      'journal.publish:recreate',
    ]);
  });

  it('keeps the same durable operation pending when queue publication fails', async () => {
    const harness = createHarness({
      publishError: new Error('kafka unavailable'),
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      dispatched: 0,
      errors: 1,
    });

    const deferred = harness.poolQuery.mock.calls.find(([statement]) =>
      String(statement).includes("SET recovery_state = 'pending'")
    );
    expect(deferred?.[1]).toEqual([
      SESSION_ID,
      HANDOFF_ID,
      expect.any(String),
      1_000,
      'error',
    ]);
    expect(
      (harness.lifecycleQueue.prepare as jest.Mock).mock.calls[0][0]
        .operation_id
    ).toBe(RECOVERY_OPERATION);
  });

  it('retries from the durable row when the worker CAS fails before dispatch', async () => {
    const harness = createHarness({ workerCasRowCount: 0 });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      dispatched: 0,
      errors: 1,
    });

    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(
      harness.poolQuery.mock.calls.some(([statement]) =>
        String(statement).includes("SET recovery_state = 'pending'")
      )
    ).toBe(true);
    expect(harness.events).toEqual([
      'lock.acquire.attempt',
      'lock.acquired',
      'db.connect',
      'db.rollback',
      'lock.released',
    ]);
  });

  it('redrives after an ambiguous post-publish database acknowledgement', async () => {
    const harness = createHarness({ dispatchAckRowCount: 0 });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      dispatched: 0,
      errors: 1,
    });

    expect(harness.lifecycleQueue.publish).toHaveBeenCalledTimes(2);
    expect(
      harness.poolQuery.mock.calls.some(([statement]) =>
        String(statement).includes("SET recovery_state = 'pending'")
      )
    ).toBe(true);
  });

  it('redrives the exact journal payload after a manager crash following the CAS', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.baileys;
        rows.worker.lifecycle_operation_id = RECOVERY_OPERATION;
        rows.handoff.recovery_state = 'dispatching';
        rows.handoff.recovery_cleanup_required = true;
        rows.handoff.recovery_from_generation = 5;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      dispatched: 1,
      errors: 0,
    });

    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
      )
    ).toBe(false);
    expect(
      (harness.lifecycleQueue.prepare as jest.Mock).mock.calls[0][0]
    ).toMatchObject({
      operation_id: RECOVERY_OPERATION,
      previous_worker_type_id: EWorkerType.wwebjs,
      cleanup_previous_runtime_required: true,
    });
  });

  it.each(
    postgresProviderHandoffPairs.flatMap((pair) => [
      { ...pair, cleanupRequired: true },
      { ...pair, cleanupRequired: false },
    ])
  )(
    'finalizes a fully fenced PostgreSQL recovery for $source -> $target (cleanup=$cleanupRequired)',
    async ({ source, sourceType, target, cleanupRequired }) => {
      const harness = createHarness({
        mutate: (rows) => {
          rows.worker.worker_type_id = sourceType;
          rows.worker.worker_status_id = EWorkerStatus.online;
          rows.worker.lifecycle_operation_id = null;
          rows.worker.container_id = 'c'.repeat(64);
          rows.runtime.container_id = 'c'.repeat(64);
          rows.runtime.runtime_generation = 6;
          rows.runtime.source_provider = source;
          rows.runtime.native_connection_online_acknowledged = true;
          rows.runtime.native_connection_status_source_id =
            '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a63';
          rows.runtime.native_connection_status_sequence = 4;
          rows.runtime.native_connection_status = {
            provider: source,
            status: 'online',
            connected: true,
            authenticated: true,
            sessionValid: true,
            qrAvailable: false,
          };
          rows.runtime.native_connection_status_lease_owner_id =
            '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
          rows.runtime.native_connection_status_fencing_token = 8;
          rows.handoff.source_provider = source;
          rows.handoff.target_provider = target;
          rows.handoff.recovery_state = 'running';
          rows.handoff.recovery_cleanup_required = cleanupRequired;
          rows.handoff.recovery_from_generation = 5;
          rows.session.provider = source;
          rows.session.generation = 6;
          rows.sourceRevision.provider = source;
          rows.sourceRevision.writer_generation = 6;
          rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
          rows.lease.provider = source;
          rows.lease.generation = 6;
          rows.lease.epoch = rows.session.epoch;
          rows.lease.fencing_token = 8;
          rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
        },
      });

      await expect(harness.service.recoverOnce()).resolves.toMatchObject({
        claimed: 1,
        completed: 1,
        dispatched: 0,
        errors: 0,
      });

      const terminal = harness.clientQuery.mock.calls.find(
        ([statement, values]) =>
          String(statement).includes('recovery_completed_at = CASE') &&
          values?.[3] === 'completed'
      );
      expect(terminal).toBeDefined();
      // The same bind parameter is written to varchar recovery_state and read
      // by the CASE. It must be explicitly typed at both sites; otherwise
      // PostgreSQL rejects the terminal update before the completed state can
      // be committed.
      expect(String(terminal?.[0])).toContain('recovery_state = $4::varchar');
      expect(String(terminal?.[0])).toContain(
        "WHEN $4::varchar = 'completed'::varchar"
      );
      expect(terminal?.[1]).toEqual([
        SESSION_ID,
        HANDOFF_ID,
        expect.any(String),
        'completed',
        null,
        RECOVERY_OPERATION,
      ]);
      expect(
        harness.centrifugoService.publishSubImmediate
      ).toHaveBeenCalledWith(`worker:handoff_recovery.account#${ACCOUNT_ID}`, {
        event_type: 'whatsapp_provider_handoff_recovery_terminal',
        account_id: ACCOUNT_ID,
        worker_id: SESSION_ID,
        handoff_id: HANDOFF_ID,
        handoff_lifecycle_operation_id: ORIGINAL_OPERATION,
        recovery_operation_id: RECOVERY_OPERATION,
        recovery_state: 'completed',
        source_provider: source,
        target_provider: target,
      });
      expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    }
  );

  it('atomically clears an attached recovery lifecycle after strict source health is durable', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.wwebjs;
        rows.worker.worker_status_id = EWorkerStatus.online;
        rows.worker.lifecycle_operation_id = RECOVERY_OPERATION;
        rows.worker.container_id = 'c'.repeat(64);
        rows.runtime.container_id = 'c'.repeat(64);
        rows.runtime.runtime_generation = 6;
        rows.runtime.source_provider = 'wwebjs';
        rows.runtime.native_connection_online_acknowledged = true;
        rows.runtime.native_connection_status_source_id =
          '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a63';
        rows.runtime.native_connection_status_sequence = 4;
        rows.runtime.native_connection_status = {
          provider: 'wwebjs',
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        };
        rows.runtime.native_connection_status_lease_owner_id =
          '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.runtime.native_connection_status_fencing_token = 8;
        rows.handoff.source_provider = 'wwebjs';
        rows.handoff.target_provider = 'baileys';
        rows.handoff.recovery_state = 'running';
        rows.handoff.recovery_cleanup_required = true;
        rows.handoff.recovery_from_generation = 5;
        rows.session.provider = 'wwebjs';
        rows.session.generation = 6;
        rows.sourceRevision.provider = 'wwebjs';
        rows.sourceRevision.writer_generation = 6;
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'wwebjs';
        rows.lease.generation = 6;
        rows.lease.epoch = rows.session.epoch;
        rows.lease.fencing_token = 8;
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      dispatched: 0,
      errors: 0,
    });

    const atomicFinalizer = harness.clientQuery.mock.calls.find(
      ([statement]) =>
        String(statement).includes('WITH finalized_worker AS') &&
        String(statement).includes("SET recovery_state = 'completed'")
    );
    expect(atomicFinalizer?.[1]).toEqual([
      SESSION_ID,
      HANDOFF_ID,
      expect.any(String),
      ACCOUNT_ID,
      SERVER_ID,
      EWorkerType.wwebjs,
      EWorkerStatus.online,
      RECOVERY_OPERATION,
      'c'.repeat(64),
      'wwebjs',
      '10',
      5,
    ]);
    expect(String(atomicFinalizer?.[0])).toContain(
      'AND handoff.recovery_claim_token = $3::uuid'
    );
    expect(String(atomicFinalizer?.[0])).toContain(
      'AND lifecycle_operation_id = $8::uuid'
    );
    const sessionLockIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes('FROM whatsapp_session AS session')
    );
    const sourceRevisionLockIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes(
          'FROM whatsapp_session_revision AS source_revision'
        )
    );
    const handoffLockIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes('FROM whatsapp_session_handoff AS handoff')
    );
    expect(sourceRevisionLockIndex).toBeGreaterThan(sessionLockIndex);
    expect(handoffLockIndex).toBeGreaterThan(sourceRevisionLockIndex);
    expect(
      String(harness.clientQuery.mock.calls[sourceRevisionLockIndex][0])
    ).toContain('FOR UPDATE OF source_revision');
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(harness.lockAssertActive).toHaveBeenCalledTimes(6);
    expect(harness.events).toEqual([
      'lock.acquire.attempt',
      'lock.acquired',
      'db.connect',
      'db.commit',
      'lock.released',
      'centrifugo.publish',
    ]);
  });

  it('keeps a committed recovery completed when the bounded history publication exhausts its retries', async () => {
    const harness = createHarness({
      mutate: makeWwebjsRecoveryHealthyWithAttachedLifecycle,
      centrifugoPublishError: new Error('centrifugo unavailable'),
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      completed: 1,
      dispatched: 0,
      errors: 0,
    });

    expect(harness.centrifugoService.publishSubImmediate).toHaveBeenCalledTimes(
      1
    );
    expect(harness.events.indexOf('db.commit')).toBeLessThan(
      harness.events.indexOf('lock.released')
    );
    expect(harness.events.indexOf('lock.released')).toBeLessThan(
      harness.events.indexOf('centrifugo.publish')
    );
    expect(
      harness.poolQuery.mock.calls.some(([statement]) =>
        String(statement).includes("SET recovery_state = 'pending'")
      )
    ).toBe(false);
  });

  it.each([
    {
      label: 'immediately before the atomic finalizer mutation',
      lockAssertFailAt: 4,
      finalizerCalls: 0,
    },
    {
      label: 'immediately before COMMIT',
      lockAssertFailAt: 5,
      finalizerCalls: 1,
    },
  ])(
    'rolls back when the lifecycle lock is lost $label',
    async ({ lockAssertFailAt, finalizerCalls }) => {
      const harness = createHarness({
        lockAssertFailAt,
        mutate: makeWwebjsRecoveryHealthyWithAttachedLifecycle,
      });

      await expect(harness.service.recoverOnce()).resolves.toMatchObject({
        claimed: 1,
        completed: 0,
        dispatched: 0,
        errors: 1,
      });

      const atomicFinalizers = harness.clientQuery.mock.calls.filter(
        ([statement]) =>
          String(statement).includes('WITH finalized_worker AS') &&
          String(statement).includes("SET recovery_state = 'completed'")
      );
      expect(atomicFinalizers).toHaveLength(finalizerCalls);
      expect(harness.events).not.toContain('db.commit');
      expect(harness.events).toEqual([
        'lock.acquire.attempt',
        'lock.acquired',
        'db.connect',
        'db.rollback',
        'lock.released',
      ]);
      expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
      expect(harness.lifecycleQueue.publish).not.toHaveBeenCalled();
    }
  );

  it('fails closed before auto-finalization when the preserved source revision is not canonical', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        makeWwebjsRecoveryHealthyWithAttachedLifecycle(rows);
        rows.sourceRevision.status = 'superseded';
        rows.sourceRevision.writer_generation = 5;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      blocked: 1,
      dispatched: 0,
      errors: 0,
    });

    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('WITH finalized_worker AS')
      )
    ).toBe(false);
    expect(
      harness.clientQuery.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes('recovery_completed_at = CASE') &&
          values?.[3] === 'blocked' &&
          values?.[4] === 'source_session_not_restored'
      )
    ).toBe(true);
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(harness.lifecycleQueue.publish).not.toHaveBeenCalled();
  });

  it('rejects a stale healthy-recovery finalization CAS without clearing another lifecycle', async () => {
    const harness = createHarness({
      workerCasRowCount: 0,
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.wwebjs;
        rows.worker.worker_status_id = EWorkerStatus.online;
        rows.worker.lifecycle_operation_id = RECOVERY_OPERATION;
        rows.worker.container_id = 'c'.repeat(64);
        rows.runtime.container_id = 'c'.repeat(64);
        rows.runtime.runtime_generation = 6;
        rows.runtime.source_provider = 'wwebjs';
        rows.runtime.native_connection_online_acknowledged = true;
        rows.runtime.native_connection_status_source_id =
          '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a63';
        rows.runtime.native_connection_status_sequence = 4;
        rows.runtime.native_connection_status = {
          provider: 'wwebjs',
          status: 'online',
          connected: true,
          authenticated: true,
          sessionValid: true,
          qrAvailable: false,
        };
        rows.runtime.native_connection_status_lease_owner_id =
          '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.runtime.native_connection_status_fencing_token = 8;
        rows.handoff.source_provider = 'wwebjs';
        rows.handoff.target_provider = 'baileys';
        rows.handoff.recovery_state = 'running';
        rows.handoff.recovery_cleanup_required = true;
        rows.handoff.recovery_from_generation = 5;
        rows.session.provider = 'wwebjs';
        rows.session.generation = 6;
        rows.sourceRevision.provider = 'wwebjs';
        rows.sourceRevision.writer_generation = 6;
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'wwebjs';
        rows.lease.generation = 6;
        rows.lease.epoch = rows.session.epoch;
        rows.lease.fencing_token = 8;
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      errors: 1,
    });

    expect(
      harness.clientQuery.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes('recovery_completed_at = CASE') &&
          values?.[3] === 'completed'
      )
    ).toBe(false);
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
  });

  it('does not finalize or mutate an immutable journal when source health is incomplete', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.baileys;
        rows.worker.worker_status_id = EWorkerStatus.disponible;
        rows.worker.lifecycle_operation_id = null;
        rows.runtime.source_provider = 'baileys';
        rows.handoff.recovery_state = 'running';
        rows.handoff.recovery_cleanup_required = true;
        rows.handoff.recovery_from_generation = 5;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      completed: 0,
      deferred: 1,
      dispatched: 0,
    });

    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
      )
    ).toBe(false);
  });

  it('blocks any legacy-volume recovery without changing the worker type', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.worker.session_storage = EWorkerSessionStorage.legacy_volume;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      blocked: 1,
      dispatched: 0,
    });

    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
      )
    ).toBe(false);
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
  });

  it('blocks a recovery row whose operation aliases the failed handoff lifecycle', async () => {
    const harness = createHarness({
      claims: [{ ...claim, recovery_operation_id: ORIGINAL_OPERATION }],
      mutate: (rows) => {
        rows.handoff.recovery_operation_id = ORIGINAL_OPERATION;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      blocked: 1,
      dispatched: 0,
      errors: 0,
    });

    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
      )
    ).toBe(false);
    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(harness.lifecycleQueue.publish).not.toHaveBeenCalled();
  });

  it('defers while an old target lease remains active', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'wwebjs';
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      deferred: 1,
      dispatched: 0,
    });

    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
      )
    ).toBe(false);
  });

  it('redrives a user return immediately through an active stale source lease', async () => {
    const harness = createHarness({
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.baileys;
        rows.worker.lifecycle_operation_id = ORIGINAL_OPERATION;
        rows.worker.container_id = 'c'.repeat(64);
        rows.runtime.container_id = 'd'.repeat(64);
        rows.runtime.source_provider = 'baileys';
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'baileys';
        rows.lease.generation = 5;
        rows.lease.epoch = rows.session.epoch;
        rows.lease.fencing_token = 8;
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
        rows.handoff.recovery_state = 'pending';
      },
    });

    await expect(
      harness.service.recoverHandoffNow({
        accountId: ACCOUNT_ID,
        handoffId: HANDOFF_ID,
        workerId: SESSION_ID,
      })
    ).resolves.toEqual({ outcome: 'dispatched' });

    const [claimStatement, claimValues] = harness.poolQuery.mock.calls[0];
    expect(String(claimStatement)).toContain(
      'AND handoff.session_id = $4::uuid'
    );
    expect(String(claimStatement)).toContain(
      'AND handoff.handoff_id = $5::uuid'
    );
    expect(claimValues).toEqual([
      1,
      expect.any(String),
      2 * 60_000,
      SESSION_ID,
      HANDOFF_ID,
      ACCOUNT_ID,
    ]);

    const workerCas = harness.clientQuery.mock.calls.find(([statement]) =>
      String(statement).includes('SET worker_type_id = $2::uuid')
    );
    expect(workerCas?.[1]).toEqual([
      SESSION_ID,
      EWorkerType.baileys,
      EWorkerStatus.recreating,
      RECOVERY_OPERATION,
      ACCOUNT_ID,
      SERVER_ID,
      EWorkerType.baileys,
      ORIGINAL_OPERATION,
    ]);
    const leaseFenceIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes('UPDATE whatsapp_session_lease') &&
        String(statement).includes('fencing_token = fencing_token + 1')
    );
    const workerCasIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes('SET worker_type_id = $2::uuid')
    );
    const recoveryJournalIndex = harness.clientQuery.mock.calls.findIndex(
      ([statement]) =>
        String(statement).includes("SET recovery_state = 'dispatching'")
    );
    expect(leaseFenceIndex).toBeGreaterThan(-1);
    expect(leaseFenceIndex).toBeLessThan(workerCasIndex);
    expect(leaseFenceIndex).toBeLessThan(recoveryJournalIndex);
    expect(harness.clientQuery.mock.calls[leaseFenceIndex][1]).toEqual([
      SESSION_ID,
      '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62',
      'baileys',
      5,
      '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a61',
      8,
    ]);
    expect(harness.lifecycleQueue.prepare).toHaveBeenCalledTimes(1);
    expect(harness.lifecycleQueue.publish).toHaveBeenCalledTimes(1);
    expect(
      (harness.lifecycleQueue.prepare as jest.Mock).mock.calls[0][0]
    ).toMatchObject({
      action: 'recreate',
      cleanup_previous_runtime_required: false,
      previous_worker_type_id: EWorkerType.baileys,
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
    });
  });

  it('blocks a stuck active source lease after bounded retries and preserves the session', async () => {
    const harness = createHarness({
      claims: [{ ...claim, recovery_attempt_count: 3 }],
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.baileys;
        rows.worker.lifecycle_operation_id = ORIGINAL_OPERATION;
        rows.worker.container_id = 'c'.repeat(64);
        rows.runtime.container_id = 'c'.repeat(64);
        rows.runtime.source_provider = 'baileys';
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'baileys';
        rows.lease.generation = 5;
        rows.lease.epoch = rows.session.epoch;
        rows.lease.fencing_token = 8;
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
        rows.handoff.recovery_attempt_count = 3;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      blocked: 1,
      dispatched: 0,
    });

    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('UPDATE whatsapp_session_lease')
      )
    ).toBe(false);
    const terminal = harness.clientQuery.mock.calls.find(
      ([statement, values]) =>
        String(statement).includes('recovery_completed_at = CASE') &&
        values?.[3] === 'blocked' &&
        values?.[4] === 'source_pq_recovery_failed'
    );
    expect(terminal).toBeDefined();
  });

  it('never fences or terminally blocks a source lease created by the recovery itself', async () => {
    const harness = createHarness({
      claims: [{ ...claim, recovery_attempt_count: 3 }],
      mutate: (rows) => {
        rows.worker.worker_type_id = EWorkerType.baileys;
        rows.worker.lifecycle_operation_id = RECOVERY_OPERATION;
        rows.worker.container_id = 'c'.repeat(64);
        rows.runtime.container_id = 'd'.repeat(64);
        rows.runtime.runtime_generation = 6;
        rows.runtime.source_provider = 'baileys';
        rows.runtime.native_connection_online_acknowledged = false;
        rows.session.generation = 6;
        rows.sourceRevision.writer_generation = 6;
        rows.lease.owner_id = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a62';
        rows.lease.provider = 'baileys';
        rows.lease.generation = 6;
        rows.lease.epoch = rows.session.epoch;
        rows.lease.fencing_token = 8;
        rows.lease.expires_at = new Date(Date.now() + 30_000).toISOString();
        rows.handoff.recovery_attempt_count = 3;
        rows.handoff.recovery_from_generation = 5;
      },
    });

    await expect(harness.service.recoverOnce()).resolves.toMatchObject({
      claimed: 1,
      deferred: 1,
      blocked: 0,
      dispatched: 0,
    });

    expect(harness.lifecycleQueue.prepare).not.toHaveBeenCalled();
    expect(
      harness.clientQuery.mock.calls.some(([statement]) =>
        String(statement).includes('UPDATE whatsapp_session_lease')
      )
    ).toBe(false);
    expect(
      harness.clientQuery.mock.calls.some(
        ([statement, values]) =>
          String(statement).includes('recovery_completed_at = CASE') &&
          values?.[3] === 'blocked' &&
          values?.[4] === 'source_pq_recovery_failed'
      )
    ).toBe(false);
  });
});
