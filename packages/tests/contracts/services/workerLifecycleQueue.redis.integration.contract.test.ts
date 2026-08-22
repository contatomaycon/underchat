import 'reflect-metadata';
jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { WorkerLifecycleQueueService } from '@core/services/workerLifecycleQueue.service';
import { IWorkerLifecycleQueueMessage } from '@core/common/interfaces/IWorkerLifecycleQueueMessage';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  legacyWorkerLifecyclePhaseLineageFingerprintV1,
  legacyWorkerLifecycleSemanticFingerprintV1,
  workerLifecyclePhaseLineageFingerprint,
  workerLifecycleSemanticFingerprint,
} from '@core/common/functions/workerLifecycleSemanticFingerprint';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('WorkerLifecycleQueueService Redis integration', () => {
  let redis: Redis;
  const keys = new Set<string>();

  const createService = (): WorkerLifecycleQueueService =>
    new WorkerLifecycleQueueService(
      {
        workerLifecycleRequest: jest.fn(() => 'worker.lifecycle.request'),
      } as never,
      { send: jest.fn(async () => undefined) } as never,
      { createTopics: jest.fn(async () => undefined) } as never,
      undefined as never,
      redis
    );

  const createPayload = (
    workerId: string,
    operationId: string
  ): IWorkerLifecycleQueueMessage => ({
    request_id: randomUUID(),
    operation_id: operationId,
    action: 'create',
    worker_id: workerId,
    account_id: randomUUID(),
    server_id: randomUUID(),
    worker_type_id: EWorkerType.baileys,
    worker_status_id: EWorkerStatus.creating,
    source: 'worker_create',
    requested_at: new Date().toISOString(),
  });

  beforeEach(() => {
    if (!redisUrl) {
      throw new Error('TEST_REDIS_URL is required for Redis integration test');
    }
    redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  });

  afterEach(async () => {
    if (redis?.status === 'wait') {
      await redis.connect();
    }
    if (keys.size > 0) {
      await redis.del(...keys);
    }
    keys.clear();
    redis.disconnect();
  });

  it('executes the atomic semantic fence, phase upgrade and stale downgrade on Redis', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    const lockKey = `underchat:worker:lifecycle:lock:${workerId}`;
    keys.add(journalKey);
    keys.add(lockKey);
    const sut = createService();
    const cold = createPayload(workerId, operationId);

    await sut.prepare(cold);
    await sut.prepare({
      ...cold,
      request_id: randomUUID(),
      requested_at: new Date(Date.now() + 1_000).toISOString(),
      debug_trace_id: randomUUID(),
    });
    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      cold,
    ]);
    await expect(
      sut.prepare({
        ...cold,
        request_id: randomUUID(),
        remove_volume: true,
      })
    ).rejects.toThrow('transaction_command_failed');

    await redis.set(lockKey, 'handler-owner', 'PX', 60_000);
    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: randomUUID(),
      action: 'activate_warm',
      warm_pool_id: randomUUID(),
    };
    await expect(sut.prepare(warm)).rejects.toThrow('phase_upgrade_locked');
    await redis.del(lockKey);
    await sut.prepare(warm);
    await sut.prepare(cold);

    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      expect.objectContaining({
        action: 'activate_warm',
        warm_pool_id: warm.warm_pool_id,
      }),
    ]);
  });

  it('adopts a legacy value atomically and rejects later semantic divergence', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    keys.add(journalKey);
    const sut = createService();
    const legacy = createPayload(workerId, operationId);
    await redis.hset(journalKey, 'primary', JSON.stringify(legacy));

    const refreshed: IWorkerLifecycleQueueMessage = {
      ...legacy,
      request_id: randomUUID(),
      requested_at: new Date(Date.now() + 1_000).toISOString(),
    };
    await sut.prepare(refreshed);
    expect(await redis.hlen(journalKey)).toBe(3);
    await expect(
      sut.prepare({
        ...refreshed,
        request_id: randomUUID(),
        remove_session: true,
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      refreshed,
    ]);
  });

  it('repairs an exact mixed-version cold-to-warm metadata mismatch atomically', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    const lockKey = `underchat:worker:lifecycle:lock:${workerId}`;
    keys.add(journalKey);
    keys.add(lockKey);
    const sut = createService();
    const cold = createPayload(workerId, operationId);
    await sut.prepare(cold);

    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: randomUUID(),
      action: 'activate_warm',
      warm_pool_id: randomUUID(),
      requested_at: new Date(Date.now() + 1_000).toISOString(),
    };
    // Simulates a writer from the previous release replacing only `primary`.
    await redis.hset(journalKey, 'primary', JSON.stringify(warm));

    await redis.set(lockKey, 'handler-owner', 'PX', 60_000);
    await expect(sut.loadPrepared(workerId, operationId)).rejects.toThrow(
      'phase_upgrade_locked'
    );
    await redis.del(lockKey);
    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      warm,
    ]);
    await expect(
      redis.hget(
        journalKey,
        '__worker_lifecycle_semantic_fingerprint_v1:primary'
      )
    ).resolves.toBe(workerLifecycleSemanticFingerprint(warm));
  });

  it('CAS-migrates only the exact pre-session_storage fingerprint pair', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    const lockKey = `underchat:worker:lifecycle:lock:${workerId}`;
    keys.add(journalKey);
    keys.add(lockKey);
    const sut = createService();
    const legacy = createPayload(workerId, operationId);
    await redis.hset(
      journalKey,
      'primary',
      JSON.stringify(legacy),
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacyWorkerLifecycleSemanticFingerprintV1(legacy),
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(legacy)
    );

    await redis.set(lockKey, 'handler-owner', 'PX', 60_000);
    await expect(sut.loadPrepared(workerId, operationId)).rejects.toThrow(
      'phase_upgrade_locked'
    );
    await redis.del(lockKey);

    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      legacy,
    ]);
    await expect(
      redis.hmget(
        journalKey,
        '__worker_lifecycle_semantic_fingerprint_v1:primary',
        '__worker_lifecycle_phase_lineage_fingerprint_v1:primary'
      )
    ).resolves.toEqual([
      workerLifecycleSemanticFingerprint(legacy),
      workerLifecyclePhaseLineageFingerprint(legacy),
    ]);

    const tamperedOperationId = randomUUID();
    const tamperedJournalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${tamperedOperationId}`;
    keys.add(tamperedJournalKey);
    const tamperBaseline = createPayload(workerId, tamperedOperationId);
    await redis.hset(
      tamperedJournalKey,
      'primary',
      JSON.stringify({
        ...tamperBaseline,
        session_storage: EWorkerSessionStorage.postgres,
      }),
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacyWorkerLifecycleSemanticFingerprintV1(tamperBaseline),
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(tamperBaseline)
    );
    await expect(
      sut.loadPrepared(workerId, tamperedOperationId)
    ).rejects.toThrow('fingerprint_integrity_mismatch');
  });

  it('repairs the exact legacy cold-to-warm predecessor fingerprint pair', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    keys.add(journalKey);
    const sut = createService();
    const cold = createPayload(workerId, operationId);
    const warm: IWorkerLifecycleQueueMessage = {
      ...cold,
      request_id: randomUUID(),
      action: 'activate_warm',
      warm_pool_id: randomUUID(),
      requested_at: new Date(Date.now() + 1_000).toISOString(),
    };
    await redis.hset(
      journalKey,
      'primary',
      JSON.stringify(warm),
      '__worker_lifecycle_semantic_fingerprint_v1:primary',
      legacyWorkerLifecycleSemanticFingerprintV1(cold),
      '__worker_lifecycle_phase_lineage_fingerprint_v1:primary',
      legacyWorkerLifecyclePhaseLineageFingerprintV1(cold)
    );

    await expect(sut.loadPrepared(workerId, operationId)).resolves.toEqual([
      warm,
    ]);
    await expect(
      redis.hmget(
        journalKey,
        '__worker_lifecycle_semantic_fingerprint_v1:primary',
        '__worker_lifecycle_phase_lineage_fingerprint_v1:primary'
      )
    ).resolves.toEqual([
      workerLifecycleSemanticFingerprint(warm),
      workerLifecyclePhaseLineageFingerprint(warm),
    ]);
  });

  it('rejects a storage-mode change when adopting a metadata-less legacy journal', async () => {
    await redis.connect();
    const workerId = randomUUID();
    const operationId = randomUUID();
    const journalKey = `underchat:worker:lifecycle:journal:v1:${workerId}:${operationId}`;
    keys.add(journalKey);
    const sut = createService();
    const legacy: IWorkerLifecycleQueueMessage = {
      ...createPayload(workerId, operationId),
      session_storage: EWorkerSessionStorage.legacy_volume,
    };
    await redis.hset(journalKey, 'primary', JSON.stringify(legacy));

    await expect(
      sut.prepare({
        ...legacy,
        request_id: randomUUID(),
        session_storage: EWorkerSessionStorage.postgres,
      })
    ).rejects.toThrow('transaction_command_failed');
    await expect(redis.hget(journalKey, 'primary')).resolves.toBe(
      JSON.stringify(legacy)
    );
  });
});
