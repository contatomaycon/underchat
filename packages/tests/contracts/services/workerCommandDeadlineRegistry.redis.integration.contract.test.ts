import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { buildWorkerCommandEnvelopeV1 } from '@core/common/functions/workerCommandEnvelope';
import {
  WORKER_COMMAND_ADMISSION_IDENTITY_MAX_BYTES,
  WORKER_COMMAND_ADMISSION_IDENTITY_MAX_RECORDS,
  WORKER_COMMAND_ADMISSION_IDENTITY_RETENTION_MS,
  WorkerCommandDeadlineRegistryService,
} from '@core/services/workerCommandDeadlineRegistry.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;
const DUE_KEY = '{worker-command-deadline:v1}:due';
const ADMISSION_INDEX_KEY = '{worker-command-admission:v1}:expires';

describe('WorkerCommandDeadlineRegistryService Redis integration', () => {
  integrationTest(
    'atomically registers payload-free identity and fences lease takeover/removal',
    async () => {
      if (!redisUrl) {
        throw new Error(
          'TEST_REDIS_URL is required for Redis integration test'
        );
      }
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const registry = new WorkerCommandDeadlineRegistryService(redis);
      const scope = randomUUID();
      const commandId = `deadline-command-${scope}`;
      const issuedAt = new Date();
      const deadlineAt = new Date(issuedAt.getTime() + 5 * 60_000);
      const envelope = buildWorkerCommandEnvelopeV1({
        command_id: commandId,
        operation_id: `deadline-operation-${scope}`,
        retry_of: null,
        account_id: `deadline-account-${scope}`,
        worker_id: `deadline-worker-${scope}`,
        command_type: 'notification_send',
        entity_key: `notification:${scope}`,
        entity_sequence: 1,
        predecessor_operation_id: null,
        origin_epoch: `epoch-${scope}`,
        issued_at: issuedAt.toISOString(),
        deadline_at: deadlineAt.toISOString(),
        payload_version: 1,
        payload: { secret: 'must-never-enter-redis', nested: { value: 7 } },
        traceparent: null,
        source: 'redis-integration-test',
      });
      const recordKey = registry.recordKey(commandId);

      try {
        await redis.connect();
        await registry.register(envelope);
        await registry.register(envelope);

        const stored = await redis.hget(recordKey, 'record');
        expect(stored).not.toBeNull();
        if (!stored) throw new Error('deadline_record_missing');
        expect(stored).not.toContain('must-never-enter-redis');
        expect(JSON.parse(stored)).not.toHaveProperty('payload');
        const absoluteExpiry = await redis.pexpiretime(recordKey);
        expect(absoluteExpiry).toBe(issuedAt.getTime() + 24 * 60 * 60 * 1000);
        await expect(
          registry.claimDue(
            new Date(deadlineAt.getTime() - 1),
            'owner-before-deadline'
          )
        ).resolves.toEqual([]);

        const first = await registry.claimDue(deadlineAt, 'owner-a');
        expect(first).toHaveLength(1);
        expect(await redis.pexpiretime(recordKey)).toBe(absoluteExpiry);
        await expect(registry.claimDue(deadlineAt, 'owner-b')).resolves.toEqual(
          []
        );

        const takeoverAt = new Date(deadlineAt.getTime() + 30_000);
        const takeover = await registry.claimDue(takeoverAt, 'owner-b');
        expect(takeover).toHaveLength(1);
        const firstClaim = first[0];
        const takeoverClaim = takeover[0];
        if (!firstClaim || !takeoverClaim) {
          throw new Error('deadline_claim_missing');
        }
        await expect(registry.complete(firstClaim)).resolves.toBe(false);
        await expect(registry.complete(takeoverClaim)).resolves.toBe(true);
        await expect(redis.zscore(DUE_KEY, commandId)).resolves.toBeNull();
        await expect(redis.exists(recordKey)).resolves.toBe(0);
      } finally {
        await redis.zrem(DUE_KEY, commandId).catch(() => undefined);
        await redis.del(recordKey).catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    }
  );

  integrationTest(
    'keeps admission identity immutable for 24h with a bounded ZSET index',
    async () => {
      if (!redisUrl) {
        throw new Error(
          'TEST_REDIS_URL is required for Redis integration test'
        );
      }
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const registry = new WorkerCommandDeadlineRegistryService(redis);
      const scope = randomUUID();
      const accountId = `admission-account-${scope}`;
      const workerId = `admission-worker-${scope}`;
      const operationId = `admission-operation-${scope}`;
      const operationDigest = createHash('sha256')
        .update(
          `worker-command-admission:v1\0${accountId}\0${workerId}\0${operationId}`
        )
        .digest('hex');
      const recordKey = registry.admissionIdentityRecordKey(operationDigest);
      const orphanDigest = createHash('sha256')
        .update(`expired-orphan:${scope}`)
        .digest('hex');
      const issuedAt = new Date();
      const baseInput = {
        accountId,
        workerId,
        entityKey: `chat:${scope}`,
        operationId,
        payloadDigest: createHash('sha256').update('payload').digest('hex'),
        commandType: 'direct_send' as const,
        originEpoch: `epoch-${scope}`,
        retryOf: null,
        proposedIssuedAt: issuedAt,
        proposedCommandId: `command-${scope}`,
      };

      try {
        await redis.connect();
        const created = await registry.reserveAdmissionIdentity(baseInput);
        const absoluteExpiry = await redis.pexpiretime(recordKey);

        expect(created).toMatchObject({
          existing: false,
          commandId: baseInput.proposedCommandId,
          originEpoch: baseInput.originEpoch,
        });
        expect(created.issuedAt).toEqual(issuedAt);
        expect(absoluteExpiry).toBe(
          issuedAt.getTime() + WORKER_COMMAND_ADMISSION_IDENTITY_RETENTION_MS
        );
        expect(await redis.zscore(ADMISSION_INDEX_KEY, operationDigest)).toBe(
          String(absoluteExpiry)
        );

        const existing = await registry.reserveAdmissionIdentity({
          ...baseInput,
          proposedIssuedAt: new Date(issuedAt.getTime() + 60_000),
          proposedCommandId: `replacement-command-${scope}`,
        });
        expect(existing).toMatchObject({
          existing: true,
          commandId: baseInput.proposedCommandId,
          originEpoch: baseInput.originEpoch,
        });
        expect(existing.issuedAt).toEqual(issuedAt);
        expect(await redis.pexpiretime(recordKey)).toBe(absoluteExpiry);

        await expect(
          registry.reserveAdmissionIdentity({
            ...baseInput,
            payloadDigest: createHash('sha256')
              .update('different-payload')
              .digest('hex'),
          })
        ).rejects.toThrow('worker_command_operation_identity_conflict');

        await redis.zadd(ADMISSION_INDEX_KEY, 0, orphanDigest);
        expect(await registry.admissionIdentityCount()).toBeGreaterThanOrEqual(
          1
        );
        await expect(
          redis.zscore(ADMISSION_INDEX_KEY, orphanDigest)
        ).resolves.toBeNull();
        expect(WORKER_COMMAND_ADMISSION_IDENTITY_MAX_RECORDS).toBe(250_000);
        expect(WORKER_COMMAND_ADMISSION_IDENTITY_MAX_BYTES).toBe(4 * 1024);
      } finally {
        await redis
          .zrem(ADMISSION_INDEX_KEY, operationDigest, orphanDigest)
          .catch(() => undefined);
        await redis.del(recordKey).catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    }
  );
});
