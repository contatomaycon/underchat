import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  legacyWorkerLifecyclePhaseLineageFingerprintV1,
  legacyWorkerLifecycleSemanticFingerprintV1,
  workerLifecyclePhaseLineageFingerprint,
  workerLifecycleSemanticFingerprint,
} from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

class FakeRedisJournal {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly pending = new Set<string>();
  private readonly quarantined = new Set<string>();
  private readonly locks = new Set<string>();
  private readonly expirations = new Map<string, number>();
  private fingerprintRepairRacesRemaining = 0;
  private nowSeconds = 0;

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<number> {
    const keys = args.slice(0, numberOfKeys);
    const argv = args.slice(numberOfKeys);
    if (script.includes("local current_payload = redis.call('HGET'")) {
      const [key, lockKey] = keys;
      const [
        field,
        semanticMetaField,
        lineageMetaField,
        expectedPayload,
        expectedSemanticFingerprint,
        expectedLineageFingerprint,
        repairedSemanticFingerprint,
        repairedLineageFingerprint,
      ] = argv;
      const hash = this.hashes.get(key);
      if (
        !hash ||
        hash.get(field) !== expectedPayload ||
        hash.get(semanticMetaField) !== expectedSemanticFingerprint ||
        hash.get(lineageMetaField) !== expectedLineageFingerprint
      ) {
        return 0;
      }
      if (this.fingerprintRepairRacesRemaining > 0) {
        this.fingerprintRepairRacesRemaining -= 1;
        return 0;
      }
      if (this.locks.has(lockKey)) {
        return 2;
      }
      hash.set(semanticMetaField, repairedSemanticFingerprint);
      hash.set(lineageMetaField, repairedLineageFingerprint);
      return 1;
    }

    if (script.includes('local finalized =')) {
      const [key] = keys;
      const [field, value, _score, pendingEntry, finalizedField] = argv;
      this.expireIfNeeded(key);
      const hash = this.hashes.get(key) ?? new Map<string, string>();
      const finalized = hash.get(finalizedField);
      if (finalized !== undefined) {
        return finalized === value ? 2 : -1;
      }
      const current = hash.get(field);
      if (current !== undefined) {
        if (current !== value) {
          return -1;
        }
        this.expirations.delete(key);
        this.pending.add(pendingEntry);
        return 0;
      }
      hash.set(field, value);
      this.hashes.set(key, hash);
      this.expirations.delete(key);
      this.pending.add(pendingEntry);
      return 1;
    }

    if (script.includes('local pending_member = ARGV[1]')) {
      const [key] = keys;
      const [
        pendingEntry,
        expectedProof,
        retentionSeconds,
        proofField,
        finalizedField,
      ] = argv;
      if (!this.pending.has(pendingEntry)) {
        return 0;
      }
      this.expireIfNeeded(key);
      const hash = this.hashes.get(key);
      if (!hash || hash.get(proofField) !== expectedProof) {
        return -1;
      }
      const proof = JSON.parse(expectedProof) as Record<string, unknown>;
      const pending = JSON.parse(pendingEntry) as Record<string, unknown>;
      if (
        proof.worker_id !== pending.worker_id ||
        proof.account_id !== pending.account_id ||
        proof.operation_id !== pending.operation_id ||
        proof.action !== 'delete' ||
        pending.action !== 'delete'
      ) {
        return -2;
      }
      this.pending.delete(pendingEntry);
      hash.set(finalizedField, expectedProof);
      this.expirations.set(key, this.nowSeconds + Number(retentionSeconds));
      return 1;
    }

    if (script.includes("redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])")) {
      const [pendingEntry, _score, quarantineRecord] = argv;
      if (!this.pending.delete(pendingEntry)) {
        return 0;
      }
      this.quarantined.add(quarantineRecord);
      return 1;
    }

    throw new Error('Unexpected Redis Lua script in test');
  }

  private expireIfNeeded(key: string): void {
    const expiration = this.expirations.get(key);
    if (expiration !== undefined && expiration <= this.nowSeconds) {
      this.hashes.delete(key);
      this.expirations.delete(key);
    }
  }

  advanceSeconds(seconds: number): void {
    this.nowSeconds += seconds;
  }

  ttl(key: string): number {
    this.expireIfNeeded(key);
    const expiration = this.expirations.get(key);
    return expiration === undefined ? -1 : expiration - this.nowSeconds;
  }

  addPending(entry: string): void {
    this.pending.add(entry);
  }

  setHashField(key: string, field: string, value: string): void {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
  }

  deleteHashField(key: string, field: string): void {
    this.hashes.get(key)?.delete(field);
  }

  lock(key: string): void {
    this.locks.add(key);
  }

  unlock(key: string): void {
    this.locks.delete(key);
  }

  raceNextFingerprintRepair(): void {
    this.fingerprintRepairRacesRemaining += 1;
  }

  pendingEntries(): string[] {
    return [...this.pending];
  }

  quarantinedEntries(): string[] {
    return [...this.quarantined];
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.expireIfNeeded(key);
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    return hash.get(field) ?? null;
  }

  multi() {
    const operations: Array<() => number> = [];
    const transaction = {
      eval: (
        _script: string,
        _numberOfKeys: number,
        key: string,
        lockKey: string,
        field: string,
        value: string,
        action: string,
        workerId: string,
        operationId: string,
        semanticFingerprint: string,
        lineageFingerprint: string,
        semanticMetaField: string,
        lineageMetaField: string
      ) => {
        operations.push(() => {
          const hash = this.hashes.get(key) ?? new Map<string, string>();
          if (field.startsWith('cleanup:')) {
            const conflictingCleanup = [...hash.keys()].some(
              (candidate) =>
                candidate.startsWith('cleanup:') && candidate !== field
            );
            if (conflictingCleanup) {
              throw new Error('cleanup semantic conflict');
            }
          }
          const current = hash.get(field);
          if (current) {
            const parsed = JSON.parse(current) as IWorkerLifecycleQueueMessage;
            const incoming = JSON.parse(value) as IWorkerLifecycleQueueMessage;
            if (
              parsed.worker_id !== workerId ||
              parsed.operation_id !== operationId
            ) {
              throw new Error('journal identity mismatch');
            }
            const storedSemantic = hash.get(semanticMetaField);
            const storedLineage = hash.get(lineageMetaField);
            if (Boolean(storedSemantic) !== Boolean(storedLineage)) {
              throw new Error('fingerprint metadata incomplete');
            }
            const currentSemantic = workerLifecycleSemanticFingerprint(parsed);
            const currentLineage =
              workerLifecyclePhaseLineageFingerprint(parsed);
            const sameSemantic = currentSemantic === semanticFingerprint;
            const sameLineage = currentLineage === lineageFingerprint;
            if (
              (storedSemantic && storedSemantic !== currentSemantic) ||
              (storedLineage && storedLineage !== currentLineage)
            ) {
              throw new Error('fingerprint integrity mismatch');
            }

            if (field === 'primary' && !sameSemantic) {
              if (
                parsed.action === 'activate_warm' &&
                action !== 'activate_warm'
              ) {
                if (!sameLineage) {
                  throw new Error('primary semantic conflict');
                }
                return 0;
              }
              if (
                parsed.action !== 'activate_warm' &&
                action === 'activate_warm'
              ) {
                if (!sameLineage) {
                  throw new Error('phase lineage conflict');
                }
                if (this.locks.has(lockKey)) {
                  return 2;
                }
              } else {
                throw new Error('primary semantic conflict');
              }
            } else if (field !== 'primary' && !sameSemantic) {
              throw new Error('cleanup semantic conflict');
            }

            if (
              sameSemantic &&
              storedSemantic &&
              storedLineage &&
              !parsed.redrive_claim_token
            ) {
              return 0;
            }
          }
          hash.set(field, value);
          hash.set(semanticMetaField, semanticFingerprint);
          hash.set(lineageMetaField, lineageFingerprint);
          this.hashes.set(key, hash);
          return 1;
        });
        return transaction;
      },
      expire: (key: string, ttlSeconds: number) => {
        operations.push(() => {
          this.expirations.set(key, this.nowSeconds + ttlSeconds);
          return 1;
        });
        return transaction;
      },
      exec: async () => {
        return operations.map((operation) => {
          try {
            return [null, operation()];
          } catch (error) {
            return [error, null];
          }
        });
      },
    };
    return transaction;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.expireIfNeeded(key);
    return Object.fromEntries(this.hashes.get(key)?.entries() ?? []);
  }

  async zrange(): Promise<string[]> {
    return [...this.pending];
  }

  async zrem(_key: string, entry: string): Promise<number> {
    return this.pending.delete(entry) ? 1 : 0;
  }
}

describe('WorkerLifecycleQueueService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes lifecycle requests to the global topic keyed by worker_id', async () => {
    const kafkaServiceQueueService = {
      workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
    };
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const kafkaService = {
      createTopics: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      kafkaServiceQueueService as never,
      streamProducerService as never,
      kafkaService as never,
      undefined as never,
      new FakeRedisJournal() as never
    );

    await sut.ensure();
    await sut.publish({
      request_id: 'request-1',
      operation_id: 'operation-1',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: true,
      remove_volume: true,
      requested_at: '2026-06-05T00:00:00.000Z',
    });

    expect(kafkaService.createTopics).toHaveBeenCalledWith(
      ['worker.lifecycle.request'],
      30,
      3
    );
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.lifecycle.request',
      expect.objectContaining({
        action: 'recreate',
        worker_id: 'worker-1',
        operation_id: 'operation-1',
      }),
      'worker-1',
      []
    );
  });

  it('keeps a redrive claim token only on the outbound delivery envelope', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const claimToken = 'operation-token:019fe267-40c7-767d-a866-7c83bcfd0350';
    const payload: IWorkerLifecycleQueueMessage = {
      request_id: 'request-token',
      operation_id: 'operation-token',
      action: 'recreate',
      worker_id: 'worker-token',
      account_id: 'account-token',
      server_id: 'server-token',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-08-08T17:24:05.101Z',
      redrive_claim_token: claimToken,
    };

    await sut.publish(payload);

    const journalKey =
      'underchat:worker:lifecycle:journal:v1:worker-token:operation-token';
    const persisted = JSON.parse(
      (await redis.hget(journalKey, 'primary')) as string
    ) as IWorkerLifecycleQueueMessage;
    expect(persisted).not.toHaveProperty('redrive_claim_token');
    expect(streamProducerService.send).toHaveBeenCalledWith(
      'worker.lifecycle.request',
      expect.objectContaining({ redrive_claim_token: claimToken }),
      'worker-token',
      []
    );
    expect(workerLifecycleSemanticFingerprint(payload)).toBe(
      workerLifecycleSemanticFingerprint(persisted)
    );
    expect(workerLifecyclePhaseLineageFingerprint(payload)).toBe(
      workerLifecyclePhaseLineageFingerprint(persisted)
    );
  });

  it('preserves the original envelope when the same durable operation is prepared again', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn(async () => undefined) } as never,
      undefined as never,
      redis as never
    );
    const original: IWorkerLifecycleQueueMessage = {
      request_id: 'request-original',
      operation_id: 'operation-stable-age',
      action: 'recreate',
      worker_id: 'worker-stable-age',
      account_id: 'account-stable-age',
      server_id: 'server-stable-age',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.recreating,
      source: 'config_recreate',
      session_storage: EWorkerSessionStorage.legacy_volume,
      requested_at: '2026-08-15T19:04:53.911-03:00',
      debug_trace_id: 'trace-original',
    };

    await sut.prepare(original);
    await sut.prepare({
      ...original,
      request_id: 'request-retry',
      requested_at: '2026-08-15T20:23:35.259-03:00',
      debug_trace_id: 'trace-retry',
    });

    await expect(
      sut.loadPrepared(original.worker_id, original.operation_id)
    ).resolves.toEqual([original]);
  });

  it('sanitizes a mixed-version stale claim token and never inherits it on a later redrive', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const durable: IWorkerLifecycleQueueMessage = {
      request_id: 'request-stale-token',
      operation_id: 'operation-stale-token',
      action: 'recreate',
      worker_id: 'worker-stale-token',
      account_id: 'account-stale-token',
      server_id: 'server-stale-token',
      worker_type_id: EWorkerType.wwebjs,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-08-08T17:24:05.101Z',
    };
    const journalKey =
      'underchat:worker:lifecycle:journal:v1:worker-stale-token:operation-stale-token';
    redis.setHashField(
      journalKey,
      'primary',
      JSON.stringify({
        ...durable,
        redrive_claim_token:
          'operation-stale-token:019fe267-40c7-767d-a866-7c83bcfd0350',
      })
    );
    redis.setHashField(
      journalKey,
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      workerLifecycleSemanticFingerprint(durable)
    );
    redis.setHashField(
      journalKey,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      workerLifecyclePhaseLineageFingerprint(durable)
    );

    await expect(
      sut.loadPrepared('worker-stale-token', 'operation-stale-token')
    ).resolves.toEqual([durable]);
    const redriven = await sut.redrivePrepared(
      'worker-stale-token',
      'operation-stale-token'
    );

    expect(redriven[0]).not.toHaveProperty('redrive_claim_token');
    const outbound = (
      streamProducerService.send.mock.calls[0] as unknown as [
        string,
        IWorkerLifecycleQueueMessage,
      ]
    )?.[1];
    expect(outbound).not.toHaveProperty('redrive_claim_token');
    const rewritten = JSON.parse(
      (await redis.hget(journalKey, 'primary')) as string
    ) as IWorkerLifecycleQueueMessage;
    expect(rewritten).not.toHaveProperty('redrive_claim_token');
  });

  it('redrives the exact prepared primary and cleanup commands', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      new FakeRedisJournal() as never
    );
    const base = {
      request_id: 'request-original',
      operation_id: 'operation-1',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      remove_session: true,
      remove_volume: true,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.baileys,
      requested_at: '2026-06-05T00:00:00.000Z',
    };

    await sut.prepare({ ...base, action: 'recreate' });
    await sut.prepare({
      ...base,
      action: 'cleanup_previous_runtime',
      server_id: 'server-old',
      previous_server_id: 'server-old',
    });
    await sut.prepare({
      ...base,
      action: 'activate_warm',
      warm_pool_id: 'warm-1',
    });

    const redriven = await sut.redrivePrepared('worker-1', 'operation-1');

    expect(redriven).toHaveLength(2);
    expect(redriven.map((item) => item.action)).toEqual([
      'cleanup_previous_runtime',
      'activate_warm',
    ]);
    expect(redriven).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'activate_warm',
          warm_pool_id: 'warm-1',
          remove_session: true,
          remove_volume: true,
        }),
      ])
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(2);
  });

  it('rejects a Postgres lifecycle that requests volume removal', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );

    await expect(
      sut.prepare({
        request_id: 'request-postgres-reset',
        operation_id: 'operation-postgres-reset',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
        remove_session: true,
        remove_volume: true,
        requested_at: '2026-08-01T19:15:20.241-03:00',
      })
    ).rejects.toThrow('payload_semantics_invalid');

    await expect(
      redis.hgetall(
        'underchat:worker:lifecycle:journal:v1:worker-1:operation-postgres-reset'
      )
    ).resolves.toEqual({});
  });

  it('rejects a provider type change backed by a legacy volume', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );

    await expect(
      sut.prepare({
        request_id: 'request-legacy-provider-switch',
        operation_id: 'operation-legacy-provider-switch',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.legacy_volume,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        remove_session: true,
        remove_volume: true,
        requested_at: '2026-08-02T15:00:00.000-03:00',
      })
    ).rejects.toThrow('payload_semantics_invalid');

    await expect(
      redis.hgetall(
        'underchat:worker:lifecycle:journal:v1:worker-1:operation-legacy-provider-switch'
      )
    ).resolves.toEqual({});
  });

  it('persists and redrives the paired destructive legacy-to-PostgreSQL conversion', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-legacy-to-postgres';
    const primary = {
      request_id: 'request-legacy-to-postgres-primary',
      operation_id: operationId,
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-target',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.baileys,
      previous_server_id: 'server-source',
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      remove_session: true,
      remove_volume: true,
      cleanup_previous_runtime_required: true,
      requested_at: '2026-08-06T12:00:00.000Z',
    };
    const cleanup = {
      ...primary,
      request_id: 'request-legacy-to-postgres-cleanup',
      action: 'cleanup_previous_runtime' as const,
      server_id: 'server-source',
      worker_type_id: EWorkerType.baileys,
    };

    await sut.prepare(primary);
    await sut.prepare(cleanup);

    await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        server_id: 'server-source',
        worker_type_id: EWorkerType.baileys,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        remove_session: true,
        remove_volume: true,
      }),
      expect.objectContaining({
        action: 'recreate',
        server_id: 'server-target',
        worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
        previous_session_storage: EWorkerSessionStorage.legacy_volume,
        cleanup_previous_runtime_required: true,
      }),
    ]);

    const redriven = await sut.redrivePrepared('worker-1', operationId);

    expect(redriven.map((payload) => payload.action)).toEqual([
      'cleanup_previous_runtime',
      'recreate',
    ]);
    expect(redriven).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previous_session_storage: EWorkerSessionStorage.legacy_volume,
          session_storage: EWorkerSessionStorage.postgres,
          remove_session: true,
          remove_volume: true,
        }),
      ])
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    [EWorkerSessionStorage.legacy_volume, EWorkerSessionStorage.postgres],
    [EWorkerSessionStorage.postgres, EWorkerSessionStorage.legacy_volume],
  ])(
    'persists and redrives a protected non-destructive storage migration from %s to %s',
    async (previousStorage, targetStorage) => {
      const redis = new FakeRedisJournal();
      const streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        streamProducerService as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        redis as never
      );
      const operationId = `operation-protected-${previousStorage}-${targetStorage}`;
      const primary: IWorkerLifecycleQueueMessage = {
        request_id: `request-protected-${previousStorage}-${targetStorage}`,
        operation_id: operationId,
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: targetStorage,
        previous_session_storage: previousStorage,
        session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
        legacy_session_volume_name: 'under-session-worker-1',
        legacy_session_checksum: 'a'.repeat(64),
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        remove_session: false,
        remove_volume: false,
        requested_at: '2026-08-15T06:00:00.000Z',
      };

      await expect(sut.prepare(primary)).resolves.toBeUndefined();
      await expect(
        sut.redrivePrepared('worker-1', operationId)
      ).resolves.toEqual([
        expect.objectContaining({
          action: 'recreate',
          previous_session_storage: previousStorage,
          session_storage: targetStorage,
          session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
          legacy_session_volume_name: 'under-session-worker-1',
          legacy_session_checksum: 'a'.repeat(64),
          remove_session: false,
          remove_volume: false,
        }),
      ]);
      expect(streamProducerService.send).toHaveBeenCalledTimes(1);
    }
  );

  it('persists and redrives the identity-only PostgreSQL finalization without source volume metadata', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-protected-postgres-finalization';
    const finalization: IWorkerLifecycleQueueMessage = {
      request_id: 'request-protected-postgres-finalization',
      operation_id: operationId,
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-08-15T06:00:00.000Z',
    };

    await expect(sut.prepare(finalization)).resolves.toBeUndefined();
    await expect(sut.redrivePrepared('worker-1', operationId)).resolves.toEqual(
      [
        expect.objectContaining({
          session_storage: EWorkerSessionStorage.postgres,
          session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
          remove_session: false,
          remove_volume: false,
        }),
      ]
    );
    const redriven = (
      streamProducerService.send.mock.calls[0] as unknown as [
        string,
        IWorkerLifecycleQueueMessage,
      ]
    )?.[1];
    expect(redriven?.previous_session_storage).toBeUndefined();
    expect(redriven?.legacy_session_volume_name).toBeUndefined();
    expect(redriven?.legacy_session_checksum).toBeUndefined();
  });

  it.each([
    ['invalid migration id', { session_storage_migration_id: 'invalid' }],
    ['source volume', { legacy_session_volume_name: 'under-session-worker-1' }],
    ['source checksum', { legacy_session_checksum: 'a'.repeat(64) }],
    [
      'source storage',
      { previous_session_storage: EWorkerSessionStorage.postgres },
    ],
    ['provider change', { previous_worker_type_id: EWorkerType.baileys }],
    ['server change', { previous_server_id: 'server-old' }],
    ['destructive flag', { remove_volume: true }],
  ])(
    'rejects an identity-only PostgreSQL finalization with %s',
    async (_case, patch) => {
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        { send: jest.fn(async () => undefined) } as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        new FakeRedisJournal() as never
      );
      const finalization: IWorkerLifecycleQueueMessage = {
        request_id: 'request-protected-postgres-finalization-invalid',
        operation_id: 'operation-protected-postgres-finalization-invalid',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.wwebjs,
        previous_worker_type_id: EWorkerType.wwebjs,
        session_storage: EWorkerSessionStorage.postgres,
        session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        remove_session: false,
        remove_volume: false,
        requested_at: '2026-08-15T06:00:00.000Z',
        ...patch,
      };

      await expect(sut.prepare(finalization)).rejects.toThrow(
        'payload_semantics_invalid'
      );
    }
  );

  it.each([
    ['missing checksum', { legacy_session_checksum: undefined }],
    ['provider change', { previous_worker_type_id: EWorkerType.baileys }],
    ['server change', { previous_server_id: 'server-old' }],
    ['destructive flag', { remove_volume: true }],
  ])('rejects a protected storage migration with %s', async (_case, patch) => {
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      new FakeRedisJournal() as never
    );
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-protected-invalid',
      operation_id: 'operation-protected-invalid',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.wwebjs,
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      session_storage_migration_id: '019ff000-0000-7000-8000-000000000001',
      legacy_session_volume_name: 'under-session-worker-1',
      legacy_session_checksum: 'a'.repeat(64),
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-08-15T06:00:00.000Z',
      ...patch,
    };

    await expect(sut.prepare(primary)).rejects.toThrow(
      'payload_semantics_invalid'
    );
  });

  it('accepts a reset-owned legacy-to-PostgreSQL conversion on the same runtime route', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-reset-legacy-to-postgres';
    const primary = {
      request_id: 'request-reset-primary',
      operation_id: operationId,
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.baileys,
      previous_server_id: 'server-1',
      session_storage: EWorkerSessionStorage.postgres,
      previous_session_storage: EWorkerSessionStorage.legacy_volume,
      worker_status_id: EWorkerStatus.recreating,
      source: 'reset_connection' as const,
      remove_session: true,
      remove_volume: true,
      cleanup_previous_runtime_required: true,
      requested_at: '2026-08-06T12:00:00.000Z',
    };
    const cleanup = {
      ...primary,
      request_id: 'request-reset-cleanup',
      action: 'cleanup_previous_runtime' as const,
      cleanup_previous_runtime_required: undefined,
    };

    await sut.prepare(primary);
    await sut.prepare(cleanup);

    await expect(sut.redrivePrepared('worker-1', operationId)).resolves.toEqual(
      [
        expect.objectContaining({
          action: 'cleanup_previous_runtime',
          source: 'reset_connection',
        }),
        expect.objectContaining({
          action: 'recreate',
          source: 'reset_connection',
          cleanup_previous_runtime_required: true,
        }),
      ]
    );
    expect(streamProducerService.send).toHaveBeenCalledTimes(2);
  });

  it('rejects a PostgreSQL type change outside the three unofficial WhatsApp providers', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );

    await expect(
      sut.prepare({
        request_id: 'request-unsupported-provider-switch',
        operation_id: 'operation-unsupported-provider-switch',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.telegram,
        session_storage: EWorkerSessionStorage.postgres,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        remove_session: false,
        remove_volume: false,
        requested_at: '2026-08-02T15:00:00.000-03:00',
      })
    ).rejects.toThrow('payload_semantics_invalid');

    await expect(
      redis.hgetall(
        'underchat:worker:lifecycle:journal:v1:worker-1:operation-unsupported-provider-switch'
      )
    ).resolves.toEqual({});
  });

  it.each([
    {
      producer: 'WorkerCreator',
      source: 'worker_create' as const,
      recoveryAction: 'create' as const,
      status: EWorkerStatus.creating,
    },
    {
      producer: 'WorkerUpdater',
      source: 'worker_update' as const,
      recoveryAction: 'recreate' as const,
      status: EWorkerStatus.recreating,
    },
  ])(
    'never lets a stale $producer recovery downgrade an activate_warm primary',
    async ({ source, recoveryAction, status }) => {
      const redis = new FakeRedisJournal();
      const streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        streamProducerService as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        redis as never
      );
      const operationId = `operation-${source}`;
      const recovery = {
        request_id: `request-recovery-${source}`,
        operation_id: operationId,
        action: recoveryAction,
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: status,
        source,
        requested_at: '2026-06-05T00:00:00.000Z',
      };

      await sut.prepare(recovery);
      const staleRecovery = (
        await sut.loadPrepared('worker-1', operationId)
      )[0];
      await sut.prepare({
        ...recovery,
        request_id: `request-warm-${source}`,
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
      });

      await sut.publish(staleRecovery);

      await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
        expect.objectContaining({
          action: 'activate_warm',
          warm_pool_id: 'warm-1',
          request_id: `request-warm-${source}`,
        }),
      ]);
      expect(streamProducerService.send).toHaveBeenCalledWith(
        'worker.lifecycle.request',
        expect.objectContaining({
          action: 'activate_warm',
          warm_pool_id: 'warm-1',
          request_id: `request-warm-${source}`,
        }),
        'worker-1',
        []
      );
    }
  );

  it('refuses a cold-to-warm phase upgrade after the command handler owns the lifecycle lock', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const recovery = {
      request_id: 'request-cold-lock-first',
      operation_id: 'operation-lock-first',
      action: 'create' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create' as const,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    await sut.prepare(recovery);
    redis.lock('underchat:worker:lifecycle:lock:worker-1');

    await expect(
      sut.prepare({
        ...recovery,
        request_id: 'request-warm-lock-first',
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
      })
    ).rejects.toThrow('phase_upgrade_locked');
    await expect(
      sut.loadPrepared('worker-1', 'operation-lock-first')
    ).resolves.toEqual([recovery]);
  });

  it.each([false, true])(
    'rejects a divergent same-action primary while lifecycle lock=%s',
    async (locked) => {
      const redis = new FakeRedisJournal();
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        { send: jest.fn(async () => undefined) } as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        redis as never
      );
      const original: IWorkerLifecycleQueueMessage = {
        request_id: 'request-original',
        operation_id: 'operation-immutable',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
        remove_session: false,
        remove_volume: false,
        requested_at: '2026-06-05T00:00:00.000Z',
      };
      await sut.prepare(original);
      if (locked) {
        redis.lock('underchat:worker:lifecycle:lock:worker-1');
      }

      await expect(
        sut.prepare({
          ...original,
          request_id: 'request-conflicting',
          remove_session: true,
          requested_at: '2026-06-05T00:01:00.000Z',
        })
      ).rejects.toThrow('transaction_command_failed');
      await expect(
        sut.loadPrepared('worker-1', 'operation-immutable')
      ).resolves.toEqual([original]);
    }
  );

  it('treats session_storage as immutable lifecycle semantics', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const original: IWorkerLifecycleQueueMessage = {
      request_id: 'request-storage-immutable',
      operation_id: 'operation-storage-immutable',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      session_storage: EWorkerSessionStorage.legacy_volume,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      requested_at: '2026-08-01T14:29:31.563-03:00',
    };
    await sut.prepare(original);

    await expect(
      sut.prepare({
        ...original,
        request_id: 'request-storage-conflict',
        session_storage: EWorkerSessionStorage.postgres,
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(
      sut.loadPrepared('worker-1', original.operation_id)
    ).resolves.toEqual([original]);
  });

  it('rejects create-to-recreate replacement inside one operation', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const create: IWorkerLifecycleQueueMessage = {
      request_id: 'request-create',
      operation_id: 'operation-action-conflict',
      action: 'create',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    await sut.prepare(create);

    await expect(
      sut.prepare({
        ...create,
        request_id: 'request-recreate',
        action: 'recreate',
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(
      sut.loadPrepared('worker-1', 'operation-action-conflict')
    ).resolves.toEqual([create]);
  });

  it('keeps cleanup semantics immutable and rejects a second cleanup identity', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-primary',
      operation_id: 'operation-cleanup-immutable',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: false,
      remove_volume: false,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.baileys,
      cleanup_previous_runtime_required: true,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-cleanup',
      action: 'cleanup_previous_runtime',
      server_id: 'server-old',
      worker_type_id: EWorkerType.baileys,
      cleanup_previous_runtime_required: undefined,
    };
    await sut.prepare(primary);
    await sut.prepare(cleanup);

    await expect(
      sut.prepare({
        ...cleanup,
        request_id: 'request-cleanup-conflicting',
        previous_worker_status_id: EWorkerStatus.online,
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(
      sut.prepare({
        ...cleanup,
        request_id: 'request-cleanup-second-server',
        server_id: 'server-other',
        previous_server_id: 'server-other',
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(
      sut.loadPrepared('worker-1', 'operation-cleanup-immutable')
    ).resolves.toEqual([cleanup, primary]);
  });

  it('accepts and redrives an explicit fresh PostgreSQL provider reset through the cold recreate path', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-fresh-provider-reset-recreate';
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-fresh-provider-reset-recreate',
      operation_id: operationId,
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.whatsmeow,
      previous_server_id: 'server-1',
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: true,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
      requested_at: '2026-08-16T21:48:54.911Z',
    };
    const cleanup: IWorkerLifecycleQueueMessage = {
      ...primary,
      request_id: 'request-fresh-provider-reset-cleanup-recreate',
      action: 'cleanup_previous_runtime',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      remove_session: false,
      cleanup_previous_runtime_required: undefined,
    };

    await sut.prepare(primary);
    await sut.prepare(cleanup);

    await expect(
      sut.redrivePrepared(primary.worker_id, operationId)
    ).resolves.toEqual([
      expect.objectContaining({
        action: 'cleanup_previous_runtime',
        worker_type_id: EWorkerType.whatsmeow,
        remove_session: false,
        remove_volume: false,
      }),
      expect.objectContaining({
        action: 'recreate',
        worker_type_id: EWorkerType.baileys,
        remove_session: true,
        remove_volume: false,
      }),
    ]);
    expect(streamProducerService.send).toHaveBeenCalledTimes(2);
  });

  it('rejects warm activation for a destructive PostgreSQL provider reset', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );

    await expect(
      sut.prepare({
        request_id: 'request-fresh-provider-reset-warm',
        operation_id: 'operation-fresh-provider-reset-warm',
        action: 'activate_warm',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        previous_worker_type_id: EWorkerType.whatsmeow,
        previous_server_id: 'server-1',
        session_storage: EWorkerSessionStorage.postgres,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_update',
        remove_session: true,
        remove_volume: false,
        cleanup_previous_runtime_required: true,
        warm_pool_id: 'warm-fresh-provider-reset',
        requested_at: '2026-08-16T21:48:54.911Z',
      })
    ).rejects.toThrow('payload_semantics_invalid');
  });

  it('rejects a destructive PostgreSQL provider reset whose source cleanup also owns session deletion', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const primary: IWorkerLifecycleQueueMessage = {
      request_id: 'request-fresh-provider-reset-primary-unsafe-cleanup',
      operation_id: 'operation-fresh-provider-reset-unsafe-cleanup',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      previous_worker_type_id: EWorkerType.whatsmeow,
      previous_server_id: 'server-1',
      session_storage: EWorkerSessionStorage.postgres,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update',
      remove_session: true,
      remove_volume: false,
      cleanup_previous_runtime_required: true,
      requested_at: '2026-08-16T21:48:54.911Z',
    };

    await sut.prepare(primary);
    await sut.prepare({
      ...primary,
      request_id: 'request-fresh-provider-reset-unsafe-cleanup',
      action: 'cleanup_previous_runtime',
      worker_type_id: EWorkerType.whatsmeow,
      cleanup_previous_runtime_required: undefined,
    });

    await expect(
      sut.loadPrepared(primary.worker_id, primary.operation_id)
    ).rejects.toThrow('cleanup_primary_identity_mismatch');
  });

  it.each([
    ['volume removal is requested', { remove_volume: true }],
    [
      'cleanup proof is missing',
      { cleanup_previous_runtime_required: undefined },
    ],
    [
      'legacy storage metadata is mixed in',
      { previous_session_storage: EWorkerSessionStorage.legacy_volume },
    ],
  ])(
    'rejects a malformed fresh PostgreSQL provider reset when %s',
    async (_case, patch) => {
      const redis = new FakeRedisJournal();
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        { send: jest.fn(async () => undefined) } as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        redis as never
      );

      await expect(
        sut.prepare({
          request_id: 'request-malformed-fresh-provider-reset',
          operation_id: 'operation-malformed-fresh-provider-reset',
          action: 'recreate',
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          previous_worker_type_id: EWorkerType.whatsmeow,
          previous_server_id: 'server-1',
          session_storage: EWorkerSessionStorage.postgres,
          worker_status_id: EWorkerStatus.recreating,
          source: 'worker_update',
          remove_session: true,
          remove_volume: false,
          cleanup_previous_runtime_required: true,
          requested_at: '2026-08-16T21:48:54.911Z',
          ...patch,
        })
      ).rejects.toThrow('payload_semantics_invalid');
      await expect(
        redis.hgetall(
          'underchat:worker:lifecycle:journal:v1:worker-1:operation-malformed-fresh-provider-reset'
        )
      ).resolves.toEqual({});
    }
  );

  it('atomically adopts matching legacy payload metadata and then fences divergence', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const key =
      'underchat:worker:lifecycle:journal:v1:worker-1:operation-legacy';
    const legacy: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy',
      operation_id: 'operation-legacy',
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    redis.setHashField(key, 'primary', JSON.stringify(legacy));
    const refreshed = {
      ...legacy,
      request_id: 'request-legacy-redrive',
      requested_at: '2026-06-05T00:01:00.000Z',
      debug_trace_id: 'trace-redrive',
    };

    await sut.prepare(refreshed);
    await expect(
      sut.prepare({
        ...refreshed,
        request_id: 'request-legacy-conflict',
        remove_volume: true,
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(
      sut.loadPrepared('worker-1', 'operation-legacy')
    ).resolves.toEqual([refreshed]);
  });

  it('atomically refuses a legacy cold-to-warm upgrade after lock acquisition', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const key =
      'underchat:worker:lifecycle:journal:v1:worker-1:operation-legacy-lock';
    const legacy: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy-cold',
      operation_id: 'operation-legacy-lock',
      action: 'create',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    redis.setHashField(key, 'primary', JSON.stringify(legacy));
    redis.lock('underchat:worker:lifecycle:lock:worker-1');

    await expect(
      sut.prepare({
        ...legacy,
        request_id: 'request-legacy-warm',
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
      })
    ).rejects.toThrow('phase_upgrade_locked');
    await expect(
      sut.loadPrepared('worker-1', 'operation-legacy-lock')
    ).resolves.toEqual([legacy]);
  });

  it('CAS-migrates an exact pre-session_storage fingerprint pair and retries one race', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-legacy-storage-fingerprint';
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const legacy: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy-storage-fingerprint',
      operation_id: operationId,
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'self_heal',
      previous_worker_status_id: EWorkerStatus.online,
      requested_at: '2026-08-01T14:29:31.563-03:00',
    };
    redis.setHashField(key, 'primary', JSON.stringify(legacy));
    redis.setHashField(
      key,
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacyWorkerLifecycleSemanticFingerprintV1(legacy)
    );
    redis.setHashField(
      key,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(legacy)
    );
    redis.raceNextFingerprintRepair();

    await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
      legacy,
    ]);
    await expect(
      redis.hget(key, '__worker_lifecycle_semantic_fingerprint_v1:primary')
    ).resolves.toBe(workerLifecycleSemanticFingerprint(legacy));
    await expect(
      redis.hget(key, '__worker_lifecycle_phase_lineage_fingerprint_v1:primary')
    ).resolves.toBe(workerLifecyclePhaseLineageFingerprint(legacy));
    await expect(redis.hget(key, 'primary')).resolves.toBe(
      JSON.stringify(legacy)
    );
  });

  it('does not migrate pre-session_storage fingerprints while the lifecycle lock is owned', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-legacy-storage-lock';
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const legacy: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy-storage-lock',
      operation_id: operationId,
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'self_heal',
      requested_at: '2026-08-01T14:29:31.563-03:00',
    };
    const legacySemantic = legacyWorkerLifecycleSemanticFingerprintV1(legacy);
    redis.setHashField(key, 'primary', JSON.stringify(legacy));
    redis.setHashField(
      key,
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacySemantic
    );
    redis.setHashField(
      key,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(legacy)
    );
    redis.lock('underchat:worker:lifecycle:lock:worker-1');

    await expect(sut.loadPrepared('worker-1', operationId)).rejects.toThrow(
      'phase_upgrade_locked'
    );
    await expect(
      redis.hget(key, '__worker_lifecycle_semantic_fingerprint_v1:primary')
    ).resolves.toBe(legacySemantic);

    redis.unlock('underchat:worker:lifecycle:lock:worker-1');
    await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
      legacy,
    ]);
  });

  it.each([
    {
      name: 'an injected storage mode',
      mutatePayload: (payload: IWorkerLifecycleQueueMessage) => ({
        ...payload,
        session_storage: EWorkerSessionStorage.postgres,
      }),
      mutateSemantic: (fingerprint: string) => fingerprint,
      mutateLineage: (fingerprint: string) => fingerprint,
    },
    {
      name: 'a changed destructive flag',
      mutatePayload: (payload: IWorkerLifecycleQueueMessage) => ({
        ...payload,
        remove_volume: true,
      }),
      mutateSemantic: (fingerprint: string) => fingerprint,
      mutateLineage: (fingerprint: string) => fingerprint,
    },
    {
      name: 'a divergent lineage hash',
      mutatePayload: (payload: IWorkerLifecycleQueueMessage) => payload,
      mutateSemantic: (fingerprint: string) => fingerprint,
      mutateLineage: () => '0'.repeat(64),
    },
  ])('rejects legacy fingerprint repair after $name', async (testCase) => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = `operation-legacy-tamper-${testCase.name.replaceAll(
      ' ',
      '-'
    )}`;
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const legacy: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy-tamper',
      operation_id: operationId,
      action: 'recreate',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate',
      remove_volume: false,
      requested_at: '2026-08-01T14:29:31.563-03:00',
    };
    redis.setHashField(
      key,
      'primary',
      JSON.stringify(testCase.mutatePayload(legacy))
    );
    redis.setHashField(
      key,
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      testCase.mutateSemantic(
        legacyWorkerLifecycleSemanticFingerprintV1(legacy)
      )
    );
    redis.setHashField(
      key,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      testCase.mutateLineage(
        legacyWorkerLifecyclePhaseLineageFingerprintV1(legacy)
      )
    );

    await expect(sut.loadPrepared('worker-1', operationId)).rejects.toThrow(
      'fingerprint_integrity_mismatch'
    );
  });

  it('repairs a legacy cold-to-warm fingerprint transition only for its exact predecessor', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-legacy-storage-cold-warm';
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const cold: IWorkerLifecycleQueueMessage = {
      request_id: 'request-legacy-storage-cold',
      operation_id: operationId,
      action: 'create',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: '2026-08-01T14:29:31.563-03:00',
    };
    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: 'request-legacy-storage-warm',
      action: 'activate_warm',
      warm_pool_id: 'warm-1',
      requested_at: '2026-08-01T14:30:31.563-03:00',
    };
    redis.setHashField(key, 'primary', JSON.stringify(warm));
    redis.setHashField(
      key,
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacyWorkerLifecycleSemanticFingerprintV1(cold)
    );
    redis.setHashField(
      key,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(cold)
    );

    await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
      warm,
    ]);
    await expect(
      redis.hget(key, '__worker_lifecycle_semantic_fingerprint_v1:primary')
    ).resolves.toBe(workerLifecycleSemanticFingerprint(warm));
    await expect(
      redis.hget(key, '__worker_lifecycle_phase_lineage_fingerprint_v1:primary')
    ).resolves.toBe(workerLifecyclePhaseLineageFingerprint(warm));
  });

  it('atomically repairs only an old-writer cold-to-warm metadata mismatch', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-mixed-version-warm';
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const cold: IWorkerLifecycleQueueMessage = {
      request_id: 'request-mixed-version-cold',
      operation_id: operationId,
      action: 'create',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: 'request-mixed-version-warm',
      action: 'activate_warm',
      warm_pool_id: 'warm-1',
      requested_at: '2026-06-05T00:01:00.000Z',
    };

    await sut.prepare(cold);
    // Simulates the pre-fence implementation, which replaced only `primary`.
    redis.setHashField(key, 'primary', JSON.stringify(warm));

    const lockKey = 'underchat:worker:lifecycle:lock:worker-1';
    redis.lock(lockKey);
    await expect(sut.loadPrepared('worker-1', operationId)).rejects.toThrow(
      'phase_upgrade_locked'
    );
    redis.unlock(lockKey);
    await expect(sut.loadPrepared('worker-1', operationId)).resolves.toEqual([
      warm,
    ]);
    await expect(
      redis.hget(key, '__worker_lifecycle_semantic_fingerprint_v1:primary')
    ).resolves.toBe(workerLifecycleSemanticFingerprint(warm));
  });

  it('fails closed for mixed-version metadata gaps and non-lineage changes', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const cold: IWorkerLifecycleQueueMessage = {
      request_id: 'request-invalid-rollout-cold',
      operation_id: 'operation-invalid-rollout',
      action: 'create',
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.creating,
      source: 'worker_create',
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    const key =
      'underchat:worker:lifecycle:journal:v1:worker-1:operation-invalid-rollout';
    await sut.prepare(cold);
    redis.setHashField(
      key,
      'primary',
      JSON.stringify({
        ...cold,
        request_id: 'request-invalid-rollout-warm',
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
        remove_volume: true,
      })
    );

    await expect(
      sut.loadPrepared('worker-1', cold.operation_id)
    ).rejects.toThrow('fingerprint_integrity_mismatch');

    redis.setHashField(
      key,
      'primary',
      JSON.stringify({
        ...cold,
        request_id: 'request-missing-rollout-warm',
        action: 'activate_warm',
        warm_pool_id: 'warm-1',
      })
    );
    redis.deleteHashField(
      key,
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary'
    );
    await expect(
      sut.loadPrepared('worker-1', cold.operation_id)
    ).rejects.toThrow('fingerprint_integrity_mismatch');
  });

  it.each([
    {
      caseName: 'an aborted EXEC',
      execResult: null,
      expectedReason: 'transaction_aborted',
    },
    {
      caseName: 'a command error inside EXEC',
      execResult: [
        [new Error('Redis write failed'), null],
        [null, 1],
      ],
      expectedReason: 'transaction_command_failed',
    },
    {
      caseName: 'an unconfirmed expiration',
      execResult: [
        [null, 1],
        [null, 0],
      ],
      expectedReason: 'transaction_not_confirmed',
    },
  ])(
    'fails closed before Kafka on $caseName',
    async ({ execResult, expectedReason }) => {
      const transaction: Record<string, jest.Mock> = {};
      transaction.eval = jest.fn(() => transaction);
      transaction.expire = jest.fn(() => transaction);
      transaction.exec = jest.fn(async () => execResult);
      const streamProducerService = {
        send: jest.fn(async () => undefined),
      };
      const sut = new WorkerLifecycleQueueService(
        {
          workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
        } as never,
        streamProducerService as never,
        { createTopics: jest.fn() } as never,
        undefined as never,
        { multi: jest.fn(() => transaction) } as never
      );

      await expect(
        sut.publish({
          request_id: 'request-exec-failure',
          operation_id: 'operation-exec-failure',
          action: 'create',
          worker_id: 'worker-1',
          account_id: 'account-1',
          server_id: 'server-1',
          worker_type_id: EWorkerType.baileys,
          worker_status_id: EWorkerStatus.creating,
          source: 'worker_create',
          requested_at: '2026-06-05T00:00:00.000Z',
        })
      ).rejects.toThrow(expectedReason);
      expect(streamProducerService.send).not.toHaveBeenCalled();
    }
  );

  it('treats an explicit false cleanup requirement as an offline-runtime exemption', async () => {
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      new FakeRedisJournal() as never
    );
    const primary = {
      request_id: 'request-offline-previous',
      operation_id: 'operation-offline-previous',
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      previous_server_id: 'server-offline',
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      cleanup_previous_runtime_required: false,
      requested_at: '2026-06-05T00:00:00.000Z',
    };

    await sut.prepare(primary);

    await expect(
      sut.loadPrepared(primary.worker_id, primary.operation_id)
    ).resolves.toEqual([primary]);
  });

  it('rejects a legacy divergent worker update without a storage contract', async () => {
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      new FakeRedisJournal() as never
    );
    const primary = {
      request_id: 'request-legacy-divergent',
      operation_id: 'operation-legacy-divergent',
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      requested_at: '2026-06-05T00:00:00.000Z',
    };

    await expect(sut.prepare(primary)).rejects.toThrow(
      'payload_semantics_invalid'
    );
  });

  it('fails closed instead of publishing a primary when its cleanup is corrupt', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-corrupt-cleanup';
    const key = `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`;
    const primary = {
      request_id: 'request-primary',
      operation_id: operationId,
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    await sut.prepare(primary);
    redis.setHashField(
      key,
      `cleanup:server-old:${EWorkerType.wwebjs}`,
      '{malformed'
    );

    await expect(sut.redrivePrepared('worker-1', operationId)).rejects.toThrow(
      'malformed_payload'
    );
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('rejects unknown fields that could hide a conflicting second primary', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const primary = {
      request_id: 'request-primary',
      operation_id: 'operation-conflict',
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_recreate' as const,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    await sut.prepare(primary);
    redis.setHashField(
      'underchat:worker:lifecycle:journal:v1:worker-1:operation-conflict',
      'primary:legacy',
      JSON.stringify({ ...primary, request_id: 'request-conflict' })
    );

    await expect(
      sut.redrivePrepared('worker-1', 'operation-conflict')
    ).rejects.toThrow('unknown_field');
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('rejects a worker-update cleanup whose account differs from its primary', async () => {
    const redis = new FakeRedisJournal();
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const operationId = 'operation-account-mismatch';
    const primary = {
      request_id: 'request-primary',
      operation_id: operationId,
      action: 'recreate' as const,
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-new',
      worker_type_id: EWorkerType.baileys,
      worker_status_id: EWorkerStatus.recreating,
      source: 'worker_update' as const,
      previous_server_id: 'server-old',
      previous_worker_type_id: EWorkerType.wwebjs,
      session_storage: EWorkerSessionStorage.postgres,
      remove_session: false,
      remove_volume: false,
      requested_at: '2026-06-05T00:00:00.000Z',
    };
    await sut.prepare(primary);
    redis.setHashField(
      `underchat:worker:lifecycle:journal:v1:worker-1:${operationId}`,
      `cleanup:server-old:${EWorkerType.wwebjs}`,
      JSON.stringify({
        ...primary,
        request_id: 'request-cleanup',
        action: 'cleanup_previous_runtime',
        account_id: 'account-other',
        server_id: 'server-old',
        worker_type_id: EWorkerType.wwebjs,
        previous_server_id: 'server-old',
        previous_worker_type_id: EWorkerType.wwebjs,
      })
    );

    await expect(sut.redrivePrepared('worker-1', operationId)).rejects.toThrow(
      'cleanup_primary_identity_mismatch'
    );
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('creates and journals a reusable permanent deletion command', async () => {
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      new FakeRedisJournal() as never
    );

    const prepared = await sut.preparePermanentDeletion({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      source: 'plan_cancellation',
    });

    expect(prepared).toEqual(
      expect.objectContaining({
        action: 'delete',
        operation_id: expect.any(String),
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        worker_status_id: EWorkerStatus.deleting,
        source: 'plan_cancellation',
        debug_trace_id: prepared.operation_id,
      })
    );
    await expect(
      sut.loadPrepared('worker-1', prepared.operation_id)
    ).resolves.toEqual([prepared]);
  });

  it('fails closed when an immutable deletion proof is replaced', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const prepared = await sut.preparePermanentDeletion({
      worker_id: 'worker-1',
      account_id: 'account-1',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      source: 'worker_delete',
    });

    await expect(
      sut.prepare({
        ...prepared,
        request_id: 'conflicting-request',
      })
    ).rejects.toThrow('immutable_conflict');
  });

  it('refuses to create a permanent deletion proof without Redis', async () => {
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never
    );

    await expect(
      sut.preparePermanentDeletion({
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.whatsmeow,
        source: 'worker_delete',
      })
    ).rejects.toThrow('redis_unavailable');
  });

  it('refuses to publish a non-delete lifecycle without a durable Redis journal', async () => {
    const streamProducerService = {
      send: jest.fn(async () => undefined),
    };
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      streamProducerService as never,
      { createTopics: jest.fn() } as never
    );

    await expect(
      sut.publish({
        request_id: 'request-1',
        operation_id: 'operation-1',
        action: 'recreate',
        worker_id: 'worker-1',
        account_id: 'account-1',
        server_id: 'server-1',
        worker_type_id: EWorkerType.baileys,
        worker_status_id: EWorkerStatus.recreating,
        source: 'worker_recreate',
        requested_at: '2026-06-05T00:00:00.000Z',
      })
    ).rejects.toThrow('redis_unavailable');
    expect(streamProducerService.send).not.toHaveBeenCalled();
  });

  it('keeps a pending deletion proof persistent and starts audit TTL only on atomic completion', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const prepared = await sut.preparePermanentDeletion({
      worker_id: 'worker-ttl',
      account_id: 'account-ttl',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      source: 'worker_delete',
    });
    const journalKey = `underchat:worker:lifecycle:journal:v1:worker-ttl:${prepared.operation_id}`;

    expect(redis.ttl(journalKey)).toBe(-1);
    redis.advanceSeconds(400 * 24 * 60 * 60);
    await expect(
      sut.loadPermanentDeletionProof('worker-ttl', prepared.operation_id)
    ).resolves.toEqual(prepared);

    await expect(
      sut.completePermanentDeletionFinalization(
        'worker-ttl',
        'account-ttl',
        prepared.operation_id
      )
    ).resolves.toBe(true);
    expect(redis.pendingEntries()).toEqual([]);
    expect(redis.ttl(journalKey)).toBeGreaterThan(0);

    // Replaying the exact command after finalization must not reopen the
    // pending index or remove the audit-retention TTL.
    const retentionTtl = redis.ttl(journalKey);
    await sut.prepare(prepared);
    expect(redis.pendingEntries()).toEqual([]);
    expect(redis.ttl(journalKey)).toBe(retentionTtl);

    redis.advanceSeconds(retentionTtl + 1);
    await expect(
      sut.loadPermanentDeletionProof('worker-ttl', prepared.operation_id)
    ).resolves.toBeNull();
  });

  it('quarantines poisoned pending members without blocking valid redrive entries', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    redis.addPending('{malformed-json');
    redis.addPending(
      JSON.stringify({
        version: 1,
        worker_id: 'orphan-worker',
        account_id: 'orphan-account',
        operation_id: 'orphan-operation',
        action: 'delete',
      })
    );
    const prepared = await sut.preparePermanentDeletion({
      worker_id: 'worker-valid',
      account_id: 'account-valid',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      source: 'worker_delete',
    });
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await expect(sut.listPendingPermanentDeletions(100)).resolves.toEqual([
      prepared,
    ]);

    expect(redis.quarantinedEntries()).toHaveLength(2);
    expect(redis.pendingEntries()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[worker-deletion-proof-audit]',
      expect.stringContaining('worker_deletion_pending_quarantined')
    );
    warn.mockRestore();
  });

  it('does not remove pending proof when completion identity mismatches', async () => {
    const redis = new FakeRedisJournal();
    const sut = new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn() } as never,
      undefined as never,
      redis as never
    );
    const prepared = await sut.preparePermanentDeletion({
      worker_id: 'worker-identity',
      account_id: 'account-correct',
      server_id: 'server-1',
      worker_type_id: EWorkerType.whatsmeow,
      source: 'worker_delete',
    });

    await expect(
      sut.completePermanentDeletionFinalization(
        'worker-identity',
        'account-wrong',
        prepared.operation_id
      )
    ).rejects.toThrow('completion_identity_mismatch');
    expect(redis.pendingEntries()).toHaveLength(1);
  });
});
