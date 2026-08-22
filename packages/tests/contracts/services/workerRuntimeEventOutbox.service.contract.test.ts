import 'reflect-metadata';
import type Redis from 'ioredis';
import type { Pool, PoolClient } from 'pg';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWhatsappConnectionStatus } from '@core/common/enums/EWhatsappConnectionStatus';
import { WorkerRuntimeEventOutboxService } from '@core/services/workerRuntimeEventOutbox.service';
import type { CentrifugoService } from '@core/services/centrifugo.service';

const WORKER_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
const ACCOUNT_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5c';
const EVENT_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';

function buildClaimedRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const qrGeneratedAt = new Date().toISOString();
  return {
    outbox_id: '42',
    event_id: EVENT_ID,
    worker_id: WORKER_ID,
    account_id: ACCOUNT_ID,
    provider: 'baileys',
    container_id: '123456789abc',
    runtime_generation: 3,
    writer_epoch: '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5e',
    connection_sequence: '7',
    capability_hash: 'a'.repeat(64),
    event_type: 'qr',
    payload: {
      code: ECodeMessage.awaitingReadQrCode,
      status: 'connecting',
      worker_status_id: EWorkerStatus.disponible,
      qrcode: 'sensitive-qr-value',
      connection_attempt_id: 'attempt-1',
      qr_generated_at: qrGeneratedAt,
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    },
    attempt_count: 1,
    worker_name: 'Support',
    session_storage: EWorkerSessionStorage.postgres,
    runtime_is_current: true,
    connection_online_acknowledged: false,
    worker_status_id: EWorkerStatus.disponible,
    worker_status_observed_at: '2026-08-07T12:00:00.500Z',
    lifecycle_operation_id: null,
    worker_container_id: 'a'.repeat(64),
    runtime_container_id: 'a'.repeat(64),
    recreate_bootstrap_operation_id: null,
    recreate_bootstrap_runtime_generation: null,
    recreate_bootstrap_container_id: null,
    recreate_bootstrap_started_at: null,
    recreate_retired_operation_id: null,
    recreate_retired_runtime_generation: null,
    recreate_retired_container_id: null,
    recreate_retired_at: null,
    connection_status_observed_at: '2026-08-07T12:00:00.000Z',
    ...overrides,
  };
}

function createHarness(input: {
  rows?: Record<string, unknown>[];
  deduplicationMarker?: string | null;
  activeQrAttempt?: Record<string, unknown> | null;
  cachedQrAttempt?: Record<string, unknown> | null;
  publishError?: Error;
  configPublishError?: Error;
  maxAttempts?: number;
  onlineAckValid?: boolean;
  reconciliationCounts?: number[];
  qrConnectingPromotion?: { worker_status_observed_at: string } | null;
}) {
  const reconciliationCounts = [...(input.reconciliationCounts ?? [])];
  const activeQrAttempt =
    input.activeQrAttempt === undefined
      ? {
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 3,
          ack: {
            connection_attempt_id: 'attempt-1',
            worker_type_id: EWorkerType.baileys,
            runtime_generation: 3,
          },
        }
      : input.activeQrAttempt;
  const clientQuery = jest.fn<
    Promise<{ rows: Record<string, unknown>[] }>,
    [statement: string, values?: unknown[]]
  >(async (statement: string) => {
    if (statement.includes('WITH first_unpublished')) {
      return { rows: input.rows ?? [buildClaimedRow()] };
    }
    return { rows: [] };
  });
  const client = {
    query: clientQuery,
    release: jest.fn(),
  } as unknown as PoolClient;
  const poolQuery = jest.fn<
    Promise<{
      rows: Array<{
        valid?: boolean;
        reconciled?: number;
        worker_status_observed_at?: string;
      }>;
      rowCount: number;
    }>,
    [statement: string, values?: unknown[]]
  >(async (statement: string) => {
    if (statement.includes('reconcile_expired_whatsapp_online_acks')) {
      const reconciled = reconciliationCounts.shift();
      return reconciled === undefined
        ? { rows: [], rowCount: 1 }
        : { rows: [{ reconciled }], rowCount: 1 };
    }
    if (statement.includes('WITH qr_connecting_fence')) {
      const promotion =
        input.qrConnectingPromotion === undefined
          ? { worker_status_observed_at: '2026-08-07T12:00:01.000Z' }
          : input.qrConnectingPromotion;
      return {
        rows: promotion ? [promotion] : [],
        rowCount: promotion ? 1 : 0,
      };
    }
    return statement.includes('runtime.native_connection_status_outbox_id')
      ? { rows: [{ valid: input.onlineAckValid === true }], rowCount: 1 }
      : { rows: [], rowCount: 1 };
  });
  const pool = {
    connect: jest.fn(async () => client),
    query: poolQuery,
  } as unknown as Pool;
  const redis = {
    get: jest.fn(async (key: string) => {
      if (key.startsWith('worker-runtime-outbox:published:')) {
        return input.deduplicationMarker ?? null;
      }
      if (key.endsWith(':active_attempt')) {
        return activeQrAttempt ? JSON.stringify(activeQrAttempt) : null;
      }
      if (key.endsWith(':attempt')) {
        return input.cachedQrAttempt
          ? JSON.stringify(input.cachedQrAttempt)
          : null;
      }
      return null;
    }),
    setex: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
  } as unknown as Redis;
  const centrifugo = {
    publishSubStrict: jest.fn(async () => {
      if (input.publishError) {
        throw input.publishError;
      }
      return {};
    }),
    publishStrict: jest.fn(async () => {
      if (input.configPublishError) {
        throw input.configPublishError;
      }
      return {};
    }),
  } as unknown as CentrifugoService;
  const service = new WorkerRuntimeEventOutboxService(pool, redis, centrifugo, {
    maxAttempts: input.maxAttempts ?? 4,
    retryBaseMs: 100,
    retryMaxMs: 1_000,
  });

  return {
    service,
    poolQuery,
    clientQuery,
    client,
    redis,
    centrifugo,
  };
}

describe('WorkerRuntimeEventOutboxService contract', () => {
  it('emits allowlisted session debug for the PostgreSQL-to-Centrifugo handoff without payload secrets', async () => {
    const previousDebug = process.env.WHATSAPP_SESSION_DEBUG_ENABLED;
    process.env.WHATSAPP_SESSION_DEBUG_ENABLED = 'true';
    const consoleLog = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    try {
      const harness = createHarness({
        rows: [
          buildClaimedRow({
            provider: 'whatsmeow',
            event_type: 'status',
            payload: {
              status: 'connected',
              code: ECodeMessage.connectionEstablished,
              worker_status_id: EWorkerStatus.online,
              phone: '5511999999999@s.whatsapp.net',
              profile: 'must-not-be-logged',
              database_url: 'postgres://secret:password@db/session',
              connection_status: {
                provider: 'whatsmeow',
                status: 'online',
                sequence: 17,
              },
            },
          }),
        ],
      });

      await expect(harness.service.drainOnce()).resolves.toBe(1);

      const output = consoleLog.mock.calls
        .map((args) => args.join(' '))
        .join('\n');
      expect(output).toContain('[whatsapp-session-debug]');
      expect(output).toContain('status_outbox.publish_started');
      expect(output).toContain('status_outbox.published');
      expect(output).toContain(`\"session_id\":\"${WORKER_ID}\"`);
      expect(output).toContain('\"provider\":\"whatsmeow\"');
      expect(output).toContain('\"sequence\":17');
      expect(output).not.toContain('5511999999999');
      expect(output).not.toContain('must-not-be-logged');
      expect(output).not.toContain('postgres://');
      expect(output).not.toContain('password');
    } finally {
      consoleLog.mockRestore();
      if (previousDebug === undefined) {
        delete process.env.WHATSAPP_SESSION_DEBUG_ENABLED;
      } else {
        process.env.WHATSAPP_SESSION_DEBUG_ENABLED = previousDebug;
      }
    }
  });

  it('claims with a short SKIP LOCKED lease and publishes QR state to Redis and Centrifugo', async () => {
    const harness = createHarness({});

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    const claimSql = String(
      harness.clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes('WITH first_unpublished')
      )?.[0]
    );
    expect(claimSql).toContain('FOR UPDATE OF queue SKIP LOCKED');
    expect(claimSql).toContain("state = 'publishing'");
    expect(claimSql).toContain(
      'runtime.connection_sequence = claimed.connection_sequence'
    );
    expect(claimSql).toContain('claimed.connection_sequence = 0');
    expect(claimSql).toContain('runtime.connection_sequence = 0');
    expect(claimSql).toContain(
      'worker.worker_status_id IS DISTINCT FROM $4::uuid'
    );
    expect(claimSql).toContain(
      'worker.lifecycle_operation_id::text AS lifecycle_operation_id'
    );
    expect(claimSql).toContain(
      'worker.updated_at::text AS worker_status_observed_at'
    );
    expect(claimSql).toContain('runtime.recreate_bootstrap_operation_id::text');
    expect(claimSql).toContain('runtime.recreate_bootstrap_started_at::text');
    expect(claimSql).toContain('runtime.recreate_retired_operation_id::text');
    expect(claimSql).toContain('runtime.recreate_retired_at::text');
    expect(claimSql).toContain(
      'claimed.created_at::text AS connection_status_observed_at'
    );
    expect(claimSql).not.toContain(
      'clock_timestamp()::text AS connection_status_observed_at'
    );
    expect(
      harness.clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes('WITH first_unpublished')
      )?.[1]
    ).toEqual([
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      EWorkerStatus.online,
      20_000,
    ]);
    expect(harness.clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(harness.client.release).toHaveBeenCalledTimes(1);

    expect(harness.redis.setex).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`,
      expect.any(Number),
      expect.stringContaining(EVENT_ID)
    );
    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        event_id: EVENT_ID,
        connection_sequence: 7,
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        connection_status_order: '42',
        connection_online_acknowledged: false,
      })
    );
    expect(harness.centrifugo.publishStrict).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({ event_id: EVENT_ID })
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(true);
    const publishedCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'published'")
    );
    expect(String(publishedCall?.[0])).toContain(
      'payload = payload - $3::text[]'
    );
    expect(publishedCall?.[1]).toEqual([
      '42',
      expect.any(String),
      [
        'qrcode',
        'pairing_code',
        'passkey_public_key',
        'passkey_confirmation_code',
        'connection_status_lease_owner_id',
        'connection_status_fencing_token',
      ],
    ]);
  });

  it('uses the Redis event marker to finish a DB publication without publishing twice', async () => {
    const harness = createHarness({ deduplicationMarker: '1' });

    await harness.service.drainOnce();

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(true);
  });

  it('never exposes a telemetry-only worker_status_id and always injects trusted order/ACK', async () => {
    const createdBeforeCompletion = '2026-08-07T11:59:59.000Z';
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          connection_status_observed_at: createdBeforeCompletion,
          payload: {
            status: 'connecting',
            worker_status_id: EWorkerStatus.online,
            disconnected_user: true,
            connection_status_observed_at: '2026-08-07T12:00:05.000Z',
            connection_status_lease_owner_id:
              '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a60',
            connection_status_fencing_token: '99',
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).not.toHaveProperty('worker_status_id');
    expect(published).not.toHaveProperty('disconnected_user');
    expect(published).not.toHaveProperty('connection_status_lease_owner_id');
    expect(published).not.toHaveProperty('connection_status_fencing_token');
    expect(published).toMatchObject({
      event_type: 'telemetry',
      connection_status_order: '42',
      connection_online_acknowledged: false,
      connection_status_observed_at: createdBeforeCompletion,
    });
  });

  it('publishes the current persisted worker status instead of a stale provider projection', async () => {
    const workerStatusObservedAt = '2026-08-07T12:00:10.000Z';
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'status',
          worker_status_id: EWorkerStatus.connecting,
          worker_status_observed_at: workerStatusObservedAt,
          payload: {
            status: 'connecting',
            worker_status_id: EWorkerStatus.disponible,
            worker_status_observed_at: '2026-08-07T12:00:02.000Z',
            connection_status: {
              provider: 'baileys',
              status: 'offline',
              connected: false,
              authenticated: false,
              sessionValid: null,
              recoverable: true,
              qrAvailable: false,
              sequence: 7,
              changedAt: '2026-08-07T12:00:02.000Z',
              reason: 'transport_interrupted',
            },
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).toMatchObject({
      event_type: 'status',
      worker_status_id: EWorkerStatus.connecting,
      worker_status_observed_at: workerStatusObservedAt,
      connection_status: {
        status: 'offline',
        reason: 'transport_interrupted',
      },
    });
  });

  it('preserves a persisted terminal worker status after pairing actually fails', async () => {
    const workerStatusObservedAt = '2026-08-07T12:01:00.000Z';
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'status',
          worker_status_id: EWorkerStatus.mismatched,
          worker_status_observed_at: workerStatusObservedAt,
          payload: {
            status: 'disconnected',
            worker_status_id: EWorkerStatus.connecting,
            worker_status_observed_at: '2026-08-07T12:00:59.000Z',
            connection_status: {
              provider: 'baileys',
              status: 'logged_out',
              connected: false,
              authenticated: false,
              sessionValid: false,
              recoverable: false,
              qrAvailable: false,
              sequence: 8,
              changedAt: workerStatusObservedAt,
              reason: 'authentication_revoked',
            },
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).toMatchObject({
      event_type: 'status',
      worker_status_id: EWorkerStatus.mismatched,
      worker_status_observed_at: workerStatusObservedAt,
      connection_status: {
        status: 'logged_out',
        reason: 'authentication_revoked',
      },
    });
  });

  it('derives connecting for a current replacement runtime without trusting the runtime payload', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
          worker_container_id: 'a'.repeat(64),
          runtime_container_id: 'b'.repeat(64),
          recreate_bootstrap_operation_id:
            '019fdf2c-63af-73e2-8107-3442eeeb8e19',
          recreate_bootstrap_runtime_generation: 3,
          recreate_bootstrap_container_id: 'b'.repeat(64),
          recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
          payload: {
            status: 'connecting',
            recreate_phase: 'recreating',
            recreate_phase_observed_at: '2099-08-07T12:00:01.000Z',
            recreate_runtime_retired: true,
            connection_status: {
              provider: 'baileys',
              status: 'initializing',
              connected: false,
              authenticated: false,
              sessionValid: null,
              recoverable: true,
              qrAvailable: false,
              sequence: 1,
              changedAt: '2026-08-07T12:00:01.000Z',
            },
            connection_status_source_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).toMatchObject({
      event_type: 'telemetry',
      runtime_generation: 3,
      recreate_phase: 'connecting',
      recreate_phase_observed_at: '2026-08-07T12:00:01.000Z',
      recreate_runtime_retired: false,
    });
    expect(published).not.toHaveProperty('worker_status_id');
    expect(published).toHaveProperty(
      'lifecycle_operation_id',
      '019fdf2c-63af-73e2-8107-3442eeeb8e19'
    );
    expect(published).not.toHaveProperty('worker_container_id');
    expect(published).not.toHaveProperty('runtime_container_id');
  });

  it('keeps an unactivated target recreating even when its payload self-asserts connecting', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: '019fdf2c-63af-73e2-8107-3442eeeb8e19',
          worker_container_id: 'a'.repeat(64),
          worker_updated_at: '2026-08-07T12:00:00.000Z',
          runtime_container_id: 'b'.repeat(64),
          runtime_activated_at: '2026-08-07T12:00:01.000Z',
          runtime_connection_activated_at: null,
          payload: {
            status: 'connecting',
            recreate_phase: 'connecting',
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).toMatchObject({
      event_type: 'telemetry',
      recreate_phase: 'recreating',
      recreate_runtime_retired: false,
    });
    expect(published).not.toHaveProperty('recreate_phase_observed_at');
  });

  it('injects the exact durable runtime retirement tombstone over forged payload fields', async () => {
    const lifecycleOperationId = '019fdf2c-63af-73e2-8107-3442eeeb8e19';
    const retiredAt = '2026-08-07T12:00:02.000Z';
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          worker_status_id: EWorkerStatus.recreating,
          lifecycle_operation_id: lifecycleOperationId,
          worker_container_id: 'b'.repeat(64),
          runtime_container_id: 'b'.repeat(64),
          recreate_bootstrap_operation_id: lifecycleOperationId,
          recreate_bootstrap_runtime_generation: 3,
          recreate_bootstrap_container_id: 'b'.repeat(64),
          recreate_bootstrap_started_at: '2026-08-07T12:00:01.000Z',
          recreate_retired_operation_id: lifecycleOperationId,
          recreate_retired_runtime_generation: 3,
          recreate_retired_container_id: 'b'.repeat(64),
          recreate_retired_at: retiredAt,
          payload: {
            status: 'connecting',
            recreate_phase: 'connecting',
            recreate_phase_observed_at: '2099-08-07T12:00:01.000Z',
            recreate_runtime_retired: false,
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    const published = (harness.centrifugo.publishSubStrict as jest.Mock).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(published).toMatchObject({
      lifecycle_operation_id: lifecycleOperationId,
      recreate_phase: 'recreating',
      recreate_phase_observed_at: retiredAt,
      recreate_runtime_retired: true,
    });
  });

  it('deletes terminal history in a bounded SKIP LOCKED retention batch', async () => {
    const harness = createHarness({ rows: [] });

    await expect(harness.service.cleanupTerminalEventsOnce()).resolves.toBe(1);

    const cleanupCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('WITH expired AS MATERIALIZED')
    );
    expect(cleanupCall).toBeDefined();
    expect(String(cleanupCall?.[0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(cleanupCall?.[0])).toContain('statement_timestamp()');
    expect(String(cleanupCall?.[0])).not.toContain(
      'published_at < clock_timestamp()'
    );
    expect(String(cleanupCall?.[0])).toContain("queue.state = 'published'");
    expect(String(cleanupCall?.[0])).toContain("queue.state = 'dead_letter'");
    expect(String(cleanupCall?.[0])).not.toContain(
      "queue.payload ? 'connection_status'"
    );
    expect(String(cleanupCall?.[0])).not.toContain(
      'worker_runtime_event_outbox AS newer'
    );
    expect(cleanupCall?.[1]).toEqual([
      7 * 24 * 60 * 60_000,
      30 * 24 * 60 * 60_000,
      5_000,
    ]);
  });

  it('reconciles lease-expired ONLINE acknowledgements before claiming realtime events', async () => {
    const harness = createHarness({ rows: [] });

    await expect(
      harness.service.reconcileExpiredOnlineAcksOnce()
    ).resolves.toBe(0);

    const reconciliationCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('reconcile_expired_whatsapp_online_acks')
    );
    expect(reconciliationCall).toBeDefined();
    expect(reconciliationCall?.[1]).toEqual([100, 5_000]);
  });

  it('drains bounded reconciliation batches in one cycle after a mass lease loss', async () => {
    const harness = createHarness({
      rows: [],
      reconciliationCounts: [100, 100, 7],
    });

    await expect(
      harness.service.reconcileExpiredOnlineAcksOnce()
    ).resolves.toBe(207);
    const reconciliationCalls = harness.poolQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('reconcile_expired_whatsapp_online_acks')
    );
    expect(reconciliationCalls).toHaveLength(3);
    expect(reconciliationCalls.every(([, values]) => values?.[0] === 100)).toBe(
      true
    );
  });

  it('clears only the matching active QR attempt after a successful connection', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'status',
          payload: {
            status: 'connected',
            worker_status_id: EWorkerStatus.online,
            connection_attempt_id: 'attempt-1',
          },
        }),
      ],
      activeQrAttempt: {
        ack: { connection_attempt_id: 'attempt-1' },
      },
    });

    await harness.service.drainOnce();

    expect(harness.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`
    );
    expect(harness.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:active_attempt`
    );
  });

  it.each([
    ['baileys', EWorkerType.baileys],
    ['wwebjs', EWorkerType.wwebjs],
    ['whatsmeow', EWorkerType.whatsmeow],
  ] as const)(
    'publishes the acknowledged ONLINE terminal for an active %s QR attempt without regressing it through the connecting promotion fence',
    async (provider, workerTypeId) => {
      const harness = createHarness({
        onlineAckValid: true,
        rows: [
          buildClaimedRow({
            provider,
            event_type: 'status',
            connection_online_acknowledged: true,
            worker_status_id: EWorkerStatus.online,
            payload: {
              status: 'connected',
              worker_status_id: EWorkerStatus.online,
              connection_attempt_id: 'attempt-1',
              connection_online_acknowledged: true,
              connection_status: {
                provider,
                status: EWhatsappConnectionStatus.online,
                connected: true,
                authenticated: true,
                sessionValid: true,
                recoverable: false,
                qrAvailable: false,
                sequence: 9,
                changedAt: '2026-08-11T15:18:19.686Z',
              },
            },
          }),
        ],
        activeQrAttempt: {
          worker_type_id: workerTypeId,
          runtime_generation: 3,
          ack: {
            connection_attempt_id: 'attempt-1',
            worker_type_id: workerTypeId,
            runtime_generation: 3,
          },
        },
      });

      await expect(harness.service.drainOnce()).resolves.toBe(1);

      expect(
        harness.poolQuery.mock.calls.some(([sql]) =>
          String(sql).includes('WITH qr_connecting_fence')
        )
      ).toBe(false);
      expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
        `worker:account#${ACCOUNT_ID}`,
        expect.objectContaining({
          worker_type_id: workerTypeId,
          worker_status_id: EWorkerStatus.online,
          connection_attempt_id: 'attempt-1',
          connection_online_acknowledged: true,
          connection_status: expect.objectContaining({
            provider,
            status: EWhatsappConnectionStatus.online,
          }),
        })
      );
      expect(harness.centrifugo.publishStrict).toHaveBeenCalledWith(
        'channels:config',
        expect.objectContaining({
          worker_status_id: EWorkerStatus.online,
          connection_attempt_id: 'attempt-1',
        })
      );
      expect(
        harness.poolQuery.mock.calls.some(([sql]) =>
          String(sql).includes("state = 'dead_letter'")
        )
      ).toBe(false);
    }
  );

  it.each([
    ['baileys', EWorkerType.baileys],
    ['wwebjs', EWorkerType.wwebjs],
    ['whatsmeow', EWorkerType.whatsmeow],
  ] as const)(
    'publishes a fenced %s ONLINE recovery after its historical QR attempt was already cleared',
    async (provider, workerTypeId) => {
      const harness = createHarness({
        onlineAckValid: true,
        activeQrAttempt: null,
        rows: [
          buildClaimedRow({
            provider,
            event_type: 'status',
            connection_online_acknowledged: true,
            worker_status_id: EWorkerStatus.online,
            payload: {
              status: 'connected',
              code: ECodeMessage.connectionEstablished,
              worker_status_id: EWorkerStatus.online,
              // Runtime generations keep the original attempt identity when
              // restoring a durable session without presenting another QR.
              connection_attempt_id: 'historical-attempt',
              connection_online_acknowledged: true,
              connection_status: {
                provider,
                status: EWhatsappConnectionStatus.online,
                connected: true,
                authenticated: true,
                sessionValid: true,
                recoverable: false,
                qrAvailable: false,
                sequence: 11,
                changedAt: '2026-08-13T14:03:50.344Z',
              },
            },
          }),
        ],
      });

      await expect(harness.service.drainOnce()).resolves.toBe(1);

      expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
        `worker:account#${ACCOUNT_ID}`,
        expect.objectContaining({
          worker_type_id: workerTypeId,
          worker_status_id: EWorkerStatus.online,
          connection_attempt_id: 'historical-attempt',
          connection_online_acknowledged: true,
        })
      );
      expect(
        harness.poolQuery.mock.calls.some(([sql]) =>
          String(sql).includes('runtime.native_connection_status_outbox_id')
        )
      ).toBe(true);
      expect(
        harness.poolQuery.mock.calls.some(([sql]) =>
          String(sql).includes("state = 'dead_letter'")
        )
      ).toBe(false);
      expect(harness.redis.del).toHaveBeenCalledWith(
        `connection:qrcode:${workerTypeId}:${WORKER_ID}:attempt`
      );
    }
  );

  it('keeps an unacknowledged historical ONLINE projection fail-closed when its QR attempt is absent', async () => {
    const harness = createHarness({
      onlineAckValid: false,
      activeQrAttempt: null,
      rows: [
        buildClaimedRow({
          event_type: 'status',
          connection_online_acknowledged: false,
          worker_status_id: EWorkerStatus.online,
          payload: {
            status: 'connected',
            code: ECodeMessage.connectionEstablished,
            worker_status_id: EWorkerStatus.online,
            connection_attempt_id: 'historical-unacknowledged-attempt',
            connection_online_acknowledged: false,
            connection_status: {
              provider: 'baileys',
              status: EWhatsappConnectionStatus.online,
              connected: true,
              authenticated: true,
              sessionValid: true,
              recoverable: false,
              qrAvailable: false,
              sequence: 12,
              changedAt: '2026-08-13T14:04:50.344Z',
            },
          },
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe('stale_qr:active_attempt_missing');
  });

  it('keeps a terminal ONLINE fail-closed when a newer QR attempt is active', async () => {
    const harness = createHarness({
      onlineAckValid: true,
      activeQrAttempt: {
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'new-attempt',
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 3,
        },
      },
      rows: [
        buildClaimedRow({
          event_type: 'status',
          connection_online_acknowledged: true,
          worker_status_id: EWorkerStatus.online,
          payload: {
            status: 'connected',
            code: ECodeMessage.connectionEstablished,
            worker_status_id: EWorkerStatus.online,
            connection_attempt_id: 'historical-attempt',
            connection_online_acknowledged: true,
            connection_status: {
              provider: 'baileys',
              status: EWhatsappConnectionStatus.online,
              connected: true,
              authenticated: true,
              sessionValid: true,
              recoverable: false,
              qrAvailable: false,
              sequence: 11,
              changedAt: '2026-08-13T14:03:50.344Z',
            },
          },
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe(
      'stale_qr:connection_attempt_mismatch'
    );
  });

  it('publishes QR exhaustion and clears the matching attempt even when a QR remains cached', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          payload: {
            status: 'disconnected',
            code: ECodeMessage.connectionClosed,
            connection_attempt_id: 'attempt-1',
            attempt: 6,
            max_attempts: 5,
          },
        }),
      ],
      activeQrAttempt: {
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'attempt-1',
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 3,
        },
      },
      cachedQrAttempt: {
        connection_attempt_id: 'attempt-1',
        runtime_generation: 3,
        qrcode: 'current-sensitive-qr',
        qr_generated_at: new Date().toISOString(),
      },
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.redis.setex).not.toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`,
      expect.any(Number),
      expect.any(String)
    );
    expect(harness.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`
    );
    expect(harness.redis.del).toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:active_attempt`
    );
    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        event_type: 'telemetry',
        status: 'disconnected',
        code: ECodeMessage.connectionClosed,
        connection_attempt_id: 'attempt-1',
        attempt: 6,
        max_attempts: 5,
      })
    );
    expect(harness.centrifugo.publishStrict).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({
        connection_attempt_id: 'attempt-1',
        attempt: 6,
        max_attempts: 5,
      })
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'dead_letter'")
      )
    ).toBe(false);
  });

  it('dead-letters acknowledged ONLINE when the lease is lost between claim and publish', async () => {
    const harness = createHarness({
      onlineAckValid: false,
      rows: [
        buildClaimedRow({
          event_type: 'status',
          connection_online_acknowledged: true,
          payload: {
            status: 'connected',
            worker_status_id: EWorkerStatus.online,
            connection_online_acknowledged: true,
            connection_status: {
              provider: 'baileys',
              status: 'online',
              connected: true,
              authenticated: true,
              sessionValid: true,
              recoverable: true,
              qrAvailable: false,
              sequence: 9,
              changedAt: '2026-08-04T12:00:09.000Z',
            },
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    const validationCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('runtime.native_connection_status_outbox_id')
    );
    expect(validationCall).toBeDefined();
    expect(String(validationCall?.[0])).toContain(
      'session_lease.expires_at > clock_timestamp()'
    );
    expect(String(validationCall?.[0])).toContain(
      'session_lease.owner_id =\n                  runtime.native_connection_status_lease_owner_id'
    );
    expect(String(validationCall?.[0])).toContain(
      'session_lease.fencing_token =\n                  runtime.native_connection_status_fencing_token'
    );
    expect(validationCall?.[1]?.[9]).toBe(20_000);
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe(
      'online_ack_invalidated_before_publish'
    );
  });

  it('releases a failed publication with bounded exponential backoff', async () => {
    const harness = createHarness({
      publishError: new Error('must not be persisted verbatim'),
    });

    await harness.service.drainOnce();

    const retryCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'pending'")
    );
    expect(retryCall).toBeDefined();
    expect(retryCall?.[1]).toEqual([
      '42',
      expect.any(String),
      100,
      'worker_runtime_event_publish_failed',
    ]);
    expect(JSON.stringify(retryCall)).not.toContain(
      'must not be persisted verbatim'
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(false);
  });

  it('retries a strict publication and marks it published only after confirmation', async () => {
    const harness = createHarness({
      publishError: new Error('temporary Centrifugo outage'),
    });

    await harness.service.drainOnce();

    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'pending'")
      )
    ).toBe(true);
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(false);

    (harness.centrifugo.publishSubStrict as jest.Mock).mockResolvedValue({});
    await harness.service.drainOnce();

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledTimes(2);
    expect(harness.centrifugo.publishStrict).toHaveBeenCalledTimes(2);
    const stateTransitions = harness.poolQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter(
        (sql) =>
          sql.includes("state = 'pending'") ||
          sql.includes("state = 'published'")
      );
    expect(stateTransitions[0]).toContain("state = 'pending'");
    expect(stateTransitions[1]).toContain("state = 'published'");
  });

  it('does not mark an event published when the second strict channel is unconfirmed', async () => {
    const harness = createHarness({
      configPublishError: new Error('config channel unavailable'),
    });

    await harness.service.drainOnce();

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledTimes(1);
    expect(harness.centrifugo.publishStrict).toHaveBeenCalledTimes(1);
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(false);
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'pending'")
      )
    ).toBe(true);
  });

  it('dead-letters a claimed event whose runtime fence is no longer current', async () => {
    const harness = createHarness({
      rows: [buildClaimedRow({ runtime_is_current: false })],
    });

    await harness.service.drainOnce();

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]).toEqual([
      '42',
      expect.any(String),
      'stale_runtime',
      [
        'qrcode',
        'pairing_code',
        'passkey_public_key',
        'passkey_confirmation_code',
        'connection_status_lease_owner_id',
        'connection_status_fencing_token',
      ],
    ]);
  });

  it('publishes a pre-fence QR with sequence zero while the runtime is still pre-fence', async () => {
    const harness = createHarness({
      rows: [buildClaimedRow({ connection_sequence: '0' })],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        event_id: EVENT_ID,
        connection_sequence: 0,
      })
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'published'")
      )
    ).toBe(true);
  });

  it('dead-letters a pre-fence QR after that runtime activates its epoch', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          connection_sequence: '0',
          runtime_is_current: false,
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.redis.setex).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe('stale_runtime');
  });

  it('dead-letters a delayed QR from an inactive connection attempt before cache or publication', async () => {
    const harness = createHarness({
      activeQrAttempt: {
        worker_type_id: EWorkerType.baileys,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'attempt-2',
          worker_type_id: EWorkerType.baileys,
          runtime_generation: 3,
        },
      },
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.redis.setex).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]).toEqual([
      '42',
      expect.any(String),
      'stale_qr:connection_attempt_mismatch',
      [
        'qrcode',
        'pairing_code',
        'passkey_public_key',
        'passkey_confirmation_code',
        'connection_status_lease_owner_id',
        'connection_status_fencing_token',
      ],
    ]);
  });

  it('dead-letters an expired QR even when its active attempt still matches', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          payload: {
            code: ECodeMessage.awaitingReadQrCode,
            status: 'connecting',
            worker_status_id: EWorkerStatus.disponible,
            qrcode: 'expired-sensitive-qr',
            connection_attempt_id: 'attempt-1',
            qr_generated_at: new Date(Date.now() - 180_000).toISOString(),
            expires_at: new Date(Date.now() - 60_000).toISOString(),
          },
        }),
      ],
    });

    await harness.service.drainOnce();

    expect(harness.redis.setex).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]).toEqual([
      '42',
      expect.any(String),
      'stale_qr:qr_expired',
      expect.any(Array),
    ]);
  });

  it('rejects an older QR when a newer QR for the same active attempt is already cached', async () => {
    const cachedGeneratedAt = new Date().toISOString();
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          payload: {
            code: ECodeMessage.awaitingReadQrCode,
            status: 'connecting',
            worker_status_id: EWorkerStatus.disponible,
            qrcode: 'older-sensitive-qr',
            connection_attempt_id: 'attempt-1',
            qr_generated_at: new Date(
              Date.parse(cachedGeneratedAt) - 10_000
            ).toISOString(),
          },
        }),
      ],
      cachedQrAttempt: {
        connection_attempt_id: 'attempt-1',
        runtime_generation: 3,
        qrcode: 'newer-sensitive-qr',
        qr_generated_at: cachedGeneratedAt,
      },
    });

    await harness.service.drainOnce();

    expect(harness.redis.setex).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe('stale_qr:newer_qr_already_cached');
  });

  it('replaces a consumed QR with pairing progress for the same fenced attempt', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          event_type: 'status',
          payload: {
            status: 'connecting',
            code: ECodeMessage.pairingInProgress,
            worker_status_id: EWorkerStatus.disponible,
            connection_attempt_id: 'attempt-1',
          },
        }),
      ],
      cachedQrAttempt: {
        connection_attempt_id: 'attempt-1',
        runtime_generation: 3,
        qrcode: 'current-sensitive-qr',
      },
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        event_type: 'status',
        worker_status_id: EWorkerStatus.connecting,
        worker_status_observed_at: '2026-08-07T12:00:01.000Z',
        code: ECodeMessage.pairingInProgress,
        connection_attempt_id: 'attempt-1',
      })
    );
    expect(harness.centrifugo.publishStrict).toHaveBeenCalledWith(
      'channels:config',
      expect.objectContaining({ code: ECodeMessage.pairingInProgress })
    );
    const setexCalls = (harness.redis.setex as unknown as jest.Mock).mock
      .calls as unknown[][];
    const cacheCall = setexCalls.find(
      (call) =>
        call[0] ===
        `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`
    );
    expect(cacheCall).toBeDefined();
    expect(JSON.parse(String(cacheCall?.[2]))).toEqual(
      expect.objectContaining({
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'attempt-1',
      })
    );
    expect(String(cacheCall?.[2])).not.toContain('current-sensitive-qr');
    expect(harness.redis.setex).not.toHaveBeenCalledWith(
      `connection:qrcode:${EWorkerType.baileys}:${WORKER_ID}:attempt`,
      expect.any(Number),
      expect.stringContaining('current-sensitive-qr')
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'dead_letter'")
      )
    ).toBe(false);
    const promotionCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('WITH qr_connecting_fence')
    );
    expect(promotionCall).toBeDefined();
    expect(String(promotionCall?.[0])).toContain(
      'pairing_grant.consumed_at IS NOT NULL'
    );
    expect(String(promotionCall?.[0])).toContain(
      'owner.worker_status_id IN ($12::uuid, $13::uuid)'
    );
    expect(String(promotionCall?.[0])).not.toContain('whatsapp_session_lease');
    expect(String(promotionCall?.[0])).toContain(
      'runtime.session_writer_epoch = queue.writer_epoch'
    );
    expect(String(promotionCall?.[0])).toContain(
      'runtime.native_connection_status_outbox_id > queue.outbox_id'
    );
    expect(String(promotionCall?.[0])).toContain('= ANY($16::text[])');
    expect(promotionCall?.[1]).toEqual([
      '42',
      expect.any(String),
      WORKER_ID,
      ACCOUNT_ID,
      3,
      'baileys',
      expect.any(String),
      '7',
      'a'.repeat(64),
      '123456789abc',
      EWorkerSessionStorage.postgres,
      EWorkerStatus.disponible,
      EWorkerStatus.connecting,
      'attempt-1',
      EWorkerType.baileys,
      [
        EWhatsappConnectionStatus.offline,
        EWhatsappConnectionStatus.loggedOut,
        EWhatsappConnectionStatus.invalidSession,
        EWhatsappConnectionStatus.conflict,
        EWhatsappConnectionStatus.leaseLost,
        EWhatsappConnectionStatus.stopped,
        EWhatsappConnectionStatus.error,
      ],
    ]);
  });

  it('promotes WhatsMeow authenticated native progress when the QR channel omits its success event', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          provider: 'whatsmeow',
          event_type: 'telemetry',
          payload: {
            status: 'connecting',
            code: ECodeMessage.info,
            connection_attempt_id: 'attempt-1',
            connection_status: {
              provider: 'whatsmeow',
              status: EWhatsappConnectionStatus.connecting,
              connected: false,
              authenticated: true,
              sessionValid: true,
              recoverable: true,
              qrAvailable: false,
              sequence: 4,
              changedAt: '2026-08-11T12:44:46.312Z',
              reason: 'authenticated',
            },
          },
        }),
      ],
      activeQrAttempt: {
        worker_type_id: EWorkerType.whatsmeow,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'attempt-1',
          worker_type_id: EWorkerType.whatsmeow,
          runtime_generation: 3,
        },
      },
      cachedQrAttempt: {
        connection_attempt_id: 'attempt-1',
        runtime_generation: 3,
        qrcode: 'current-sensitive-qr',
      },
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.connecting,
        worker_status_observed_at: '2026-08-07T12:00:01.000Z',
        status: 'connecting',
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'attempt-1',
      })
    );
    const published = (
      harness.centrifugo.publishSubStrict as unknown as jest.Mock
    ).mock.calls[0]?.[1];
    expect(published).not.toHaveProperty('qrcode');
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes('WITH qr_connecting_fence')
      )
    ).toBe(true);
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'dead_letter'")
      )
    ).toBe(false);
  });

  it('keeps authenticated native telemetry outside a QR attempt as ordinary telemetry', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          provider: 'whatsmeow',
          event_type: 'telemetry',
          payload: {
            status: 'reconnecting',
            code: ECodeMessage.info,
            connection_status: {
              provider: 'whatsmeow',
              status: EWhatsappConnectionStatus.reconnecting,
              connected: false,
              authenticated: true,
              sessionValid: true,
              recoverable: true,
              qrAvailable: false,
              sequence: 8,
              changedAt: '2026-08-11T12:44:44.504Z',
              reason: 'transport_recovery',
            },
          },
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        status: 'reconnecting',
        code: ECodeMessage.info,
      })
    );
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes('WITH qr_connecting_fence')
      )
    ).toBe(false);
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'dead_letter'")
      )
    ).toBe(false);
  });

  it('does not let delayed QR consumption regress a newer terminal native state to connecting', async () => {
    const harness = createHarness({
      qrConnectingPromotion: null,
      activeQrAttempt: {
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'attempt-1',
          worker_type_id: EWorkerType.wwebjs,
          runtime_generation: 3,
        },
      },
      rows: [
        buildClaimedRow({
          provider: 'wwebjs',
          event_type: 'status',
          payload: {
            status: 'connecting',
            code: ECodeMessage.pairingInProgress,
            connection_attempt_id: 'attempt-1',
          },
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    const promotionCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes('WITH qr_connecting_fence')
    );
    expect(String(promotionCall?.[0])).toContain(
      'runtime.native_connection_status_outbox_id > queue.outbox_id'
    );
    expect(String(promotionCall?.[0])).toContain(
      "runtime.native_connection_public_status ->> 'status'"
    );
    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe('qr_connecting_fence_rejected');
  });

  it('does not publish pairing progress when the durable connecting fence is rejected', async () => {
    const harness = createHarness({
      qrConnectingPromotion: null,
      rows: [
        buildClaimedRow({
          event_type: 'telemetry',
          payload: {
            status: 'connecting',
            code: ECodeMessage.pairingInProgress,
            connection_attempt_id: 'attempt-1',
          },
        }),
      ],
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).not.toHaveBeenCalled();
    expect(harness.centrifugo.publishStrict).not.toHaveBeenCalled();
    const deadLetterCall = harness.poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("state = 'dead_letter'")
    );
    expect(deadLetterCall?.[1]?.[2]).toBe('qr_connecting_fence_rejected');
  });

  it('publishes WWebJS authenticated native status instead of dead-lettering it behind the cached QR', async () => {
    const harness = createHarness({
      rows: [
        buildClaimedRow({
          provider: 'wwebjs',
          event_type: 'status',
          payload: {
            status: 'connecting',
            code: ECodeMessage.awaitingReadQrCode,
            worker_status_id: EWorkerStatus.disponible,
            connection_attempt_id: 'attempt-1',
            connection_status: {
              provider: 'wwebjs',
              status: 'connecting',
              connected: false,
              authenticated: true,
              sessionValid: true,
              recoverable: true,
              qrAvailable: false,
              sequence: 4,
              changedAt: '2026-08-04T23:06:06.205Z',
              reason: 'authenticated',
            },
          },
        }),
      ],
      activeQrAttempt: {
        worker_type_id: EWorkerType.wwebjs,
        runtime_generation: 3,
        ack: {
          connection_attempt_id: 'attempt-1',
          worker_type_id: EWorkerType.wwebjs,
          runtime_generation: 3,
        },
      },
      cachedQrAttempt: {
        connection_attempt_id: 'attempt-1',
        runtime_generation: 3,
        qrcode: 'current-sensitive-qr',
      },
    });

    await expect(harness.service.drainOnce()).resolves.toBe(1);

    expect(harness.centrifugo.publishSubStrict).toHaveBeenCalledWith(
      `worker:account#${ACCOUNT_ID}`,
      expect.objectContaining({
        worker_type_id: EWorkerType.wwebjs,
        code: ECodeMessage.pairingInProgress,
        qr_pending: false,
        connection_attempt_id: 'attempt-1',
      })
    );
    const published = (
      harness.centrifugo.publishSubStrict as unknown as jest.Mock
    ).mock.calls[0]?.[1];
    expect(published).not.toHaveProperty('qrcode');
    expect(
      harness.poolQuery.mock.calls.some(([sql]) =>
        String(sql).includes("state = 'dead_letter'")
      )
    ).toBe(false);
  });
});
