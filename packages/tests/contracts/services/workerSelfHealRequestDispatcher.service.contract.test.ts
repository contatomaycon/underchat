import 'reflect-metadata';

import type { Pool, PoolClient } from 'pg';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import type { IWorkerSelfHealingRequestProto } from '@core/common/interfaces/IWorkerSelfHealingRequestProto';
import { WorkerSelfHealRequestDispatcherService } from '@core/services/workerSelfHealRequestDispatcher.service';
import type { WorkerGrpcClientService } from '@core/services/workerGrpcClient.service';

const REQUEST_ID = '019c22a7-8bc2-7e20-8620-e81ec8b30101';
const WORKER_ID = '019c22a7-8bc2-7e20-8620-e81ec8b30102';
const ACCOUNT_ID = '019c22a7-8bc2-7e20-8620-e81ec8b30103';
const SERVER_ID = '019c22a7-8bc2-7e20-8620-e81ec8b30104';
const WRITER_EPOCH = '019c22a7-8bc2-7e20-8620-e81ec8b30105';

interface DispatcherRow {
  request_id: string;
  worker_id: string;
  account_id: string;
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  container_id: string;
  runtime_generation: number;
  writer_epoch: string;
  capability_hash: string;
  reason: string;
  evidence: Record<string, unknown>;
  attempt_count: number;
  server_id: string | null;
  runtime_is_current: boolean;
  worker_is_dispatchable: boolean;
}

function buildRow(overrides: Partial<DispatcherRow> = {}): DispatcherRow {
  return {
    request_id: REQUEST_ID,
    worker_id: WORKER_ID,
    account_id: ACCOUNT_ID,
    provider: 'baileys',
    container_id: '123456789abcdef0',
    runtime_generation: 7,
    writer_epoch: WRITER_EPOCH,
    capability_hash: 'a'.repeat(64),
    reason: 'runtime_unhealthy',
    evidence: {
      source: 'health_monitor',
      provider_state: 'open',
      degraded_reason: 'kafka_unhealthy',
      kafka_unhealthy: true,
      session_ready: true,
      can_send: true,
      can_receive_runtime: true,
      authenticated: true,
      phone: '5511999999999',
      debug_trace_id: 'trace-1',
      recovery_window_seconds: 600,
    },
    attempt_count: 1,
    server_id: SERVER_ID,
    runtime_is_current: true,
    worker_is_dispatchable: true,
    ...overrides,
  };
}

function createHarness(input: {
  rows?: DispatcherRow[];
  claimError?: Error;
  dispatchError?: Error & { code?: unknown };
  options?: {
    batchSize?: number;
    leaseMs?: number;
    maxAttempts?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
  };
}) {
  const clientQuery = jest.fn<
    Promise<{ rows: DispatcherRow[] }>,
    [statement: string, values?: unknown[]]
  >(async (statement: string): Promise<{ rows: DispatcherRow[] }> => {
    if (statement.includes('WITH eligible AS')) {
      if (input.claimError) throw input.claimError;
      return { rows: input.rows ?? [buildRow()] };
    }
    return { rows: [] };
  });
  const client = {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient;
  const poolQuery = jest.fn(
    async (): Promise<{ rows: never[]; rowCount: number }> => ({
      rows: [],
      rowCount: 1,
    })
  );
  const pool = {
    connect: jest.fn(async () => client),
    query: poolQuery,
  } as unknown as Pool;
  const requestWorkerSelfHealing = jest.fn(
    async (
      _serverId: string,
      _payload: IWorkerSelfHealingRequestProto
    ): Promise<void> => {
      if (input.dispatchError) throw input.dispatchError;
    }
  );
  const grpcClient = {
    requestWorkerSelfHealing,
  } as unknown as WorkerGrpcClientService;
  const service = new WorkerSelfHealRequestDispatcherService(pool, grpcClient, {
    batchSize: 3,
    leaseMs: 45_000,
    maxAttempts: 4,
    retryBaseMs: 100,
    retryMaxMs: 1_000,
    ...input.options,
  });

  return {
    service,
    client,
    clientQuery,
    poolQuery,
    requestWorkerSelfHealing,
  };
}

function findPoolUpdate(
  poolQuery: jest.Mock,
  state: 'queued' | 'completed' | 'cancelled'
): [string, unknown[]] | undefined {
  return poolQuery.mock.calls.find(([statement]) =>
    String(statement).includes(`state = '${state}'`)
  ) as [string, unknown[]] | undefined;
}

describe('WorkerSelfHealRequestDispatcherService contract', () => {
  it('atomically claims current requests with a bounded lease and SKIP LOCKED', async () => {
    const harness = createHarness({});

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    const claimCall = harness.clientQuery.mock.calls.find(([statement]) =>
      String(statement).includes('WITH eligible AS')
    );
    const claimSql = String(claimCall?.[0]);
    const claimValues = claimCall?.[1] as unknown[] | undefined;
    expect(claimSql).toContain("request.state = 'queued'");
    expect(claimSql).toContain("request.state = 'processing'");
    expect(claimSql).toContain('request.lease_expires_at <= clock_timestamp()');
    expect(claimSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain('attempt_count = request.attempt_count + 1');
    expect(claimSql).toContain('lease_owner = $1::uuid');
    expect(claimSql).toContain(
      'runtime.session_writer_epoch = claimed.writer_epoch'
    );
    expect(claimSql).toContain(
      'runtime.runtime_capability_hash = claimed.capability_hash'
    );
    expect(claimSql).toContain('worker.lifecycle_operation_id IS NULL');
    expect(claimValues).toEqual([
      expect.any(String),
      3,
      45_000,
      expect.any(String),
      EWorkerType.baileys,
      EWorkerType.wwebjs,
      EWorkerType.whatsmeow,
    ]);
    expect(harness.clientQuery).toHaveBeenCalledWith('BEGIN');
    expect(harness.clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(harness.client.release).toHaveBeenCalledTimes(1);

    const completed = findPoolUpdate(harness.poolQuery, 'completed');
    expect(completed).toBeDefined();
    expect(String(completed?.[0])).toContain(
      "request_id = $1::uuid AND state = 'processing'"
    );
    expect(String(completed?.[0])).toContain('lease_owner = $2::uuid');
    expect(completed?.[1]).toEqual([REQUEST_ID, claimValues?.[0]]);
  });

  it('dispatches only canonical worker/runtime identity and sanitized evidence fields', async () => {
    const row = buildRow({
      provider: 'wwebjs',
      reason: ' browser_unhealthy ',
      evidence: {
        worker_id: 'spoofed-worker',
        account_id: 'spoofed-account',
        worker_type_id: EWorkerType.whatsmeow,
        runtime_generation: 999,
        reason: 'spoofed-reason',
        source: '  daily_maintenance  ',
        provider_state: '  connected  ',
        degraded_reason: '  chromium_stalled  ',
        kafka_unhealthy: true,
        session_ready: 'true',
        can_send: false,
        can_receive_runtime: true,
        authenticated: true,
        phone: ' 5511888888888 ',
        debug_trace_id: ' trace-2 ',
        recovery_window_seconds: '900',
        ignored_secret: 'must-not-cross-the-control-plane',
      },
    });
    const harness = createHarness({ rows: [row] });

    await harness.service.drainOnce();

    expect(harness.requestWorkerSelfHealing).toHaveBeenCalledTimes(1);
    expect(harness.requestWorkerSelfHealing).toHaveBeenCalledWith(SERVER_ID, {
      worker_id: WORKER_ID,
      account_id: ACCOUNT_ID,
      worker_type_id: EWorkerType.wwebjs,
      runtime_generation: 7,
      reason: 'browser_unhealthy',
      source: 'daily_maintenance',
      provider_state: 'connected',
      degraded_reason: 'chromium_stalled',
      kafka_unhealthy: true,
      session_ready: undefined,
      can_send: false,
      can_receive_runtime: true,
      authenticated: true,
      phone: '5511888888888',
      debug_trace_id: 'trace-2',
      recovery_window_seconds: 900,
    });
    expect(
      JSON.stringify(harness.requestWorkerSelfHealing.mock.calls[0]?.[1])
    ).not.toContain('must-not-cross-the-control-plane');
  });

  it.each([
    ['runtime fence', { runtime_is_current: false }],
    ['worker lifecycle', { worker_is_dispatchable: false }],
    ['server ownership', { server_id: null }],
  ])(
    'cancels a stale request when %s is no longer current',
    async (_, patch) => {
      const harness = createHarness({ rows: [buildRow(patch)] });

      await harness.service.drainOnce();

      expect(harness.requestWorkerSelfHealing).not.toHaveBeenCalled();
      const cancelled = findPoolUpdate(harness.poolQuery, 'cancelled');
      expect(cancelled?.[1]).toEqual([
        REQUEST_ID,
        expect.any(String),
        'stale_runtime',
      ]);
    }
  );

  it('releases a transient failure with bounded exponential backoff and no error message', async () => {
    const dispatchError = Object.assign(
      new Error('postgres://secret:password@internal.example/db'),
      { code: 14 }
    );
    dispatchError.name = 'ServiceError';
    const harness = createHarness({
      rows: [buildRow({ attempt_count: 3 })],
      dispatchError,
      options: { maxAttempts: 4, retryBaseMs: 100, retryMaxMs: 1_000 },
    });

    await harness.service.drainOnce();

    const retry = findPoolUpdate(harness.poolQuery, 'queued');
    expect(retry?.[1]).toEqual([
      REQUEST_ID,
      expect.any(String),
      400,
      'worker_self_heal_dispatch_failed:code_14',
    ]);
    expect(JSON.stringify(retry)).not.toContain('secret:password');
  });

  it('cancels after the configured maximum attempt without another lease cycle', async () => {
    const dispatchError = Object.assign(new Error('unavailable'), { code: 14 });
    dispatchError.name = 'ServiceError';
    const harness = createHarness({
      rows: [buildRow({ attempt_count: 4 })],
      dispatchError,
      options: { maxAttempts: 4 },
    });

    await harness.service.drainOnce();

    expect(findPoolUpdate(harness.poolQuery, 'queued')).toBeUndefined();
    expect(findPoolUpdate(harness.poolQuery, 'cancelled')?.[1]).toEqual([
      REQUEST_ID,
      expect.any(String),
      'worker_self_heal_dispatch_failed:code_14',
    ]);
  });

  it('cancels an expired lease reclaimed beyond max attempts without dispatching it again', async () => {
    const harness = createHarness({
      rows: [buildRow({ attempt_count: 5 })],
      options: { maxAttempts: 4 },
    });

    await harness.service.drainOnce();

    expect(harness.requestWorkerSelfHealing).not.toHaveBeenCalled();
    expect(findPoolUpdate(harness.poolQuery, 'cancelled')?.[1]).toEqual([
      REQUEST_ID,
      expect.any(String),
      'max_attempts_exhausted',
    ]);
  });

  it('rolls back and releases the client when claiming fails', async () => {
    const harness = createHarness({ claimError: new Error('claim failed') });

    await expect(harness.service.drainOnce()).rejects.toThrow('claim failed');

    expect(harness.clientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(harness.client.release).toHaveBeenCalledTimes(1);
    expect(harness.requestWorkerSelfHealing).not.toHaveBeenCalled();
  });
});
