import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  IMessageSendAcquiredClaim,
  MESSAGE_SEND_LEDGER_V4_POLICY,
  MessageSendIdempotencyService,
} from '@core/services/messageSendIdempotency.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;
const WATCHDOG_KEY = 'message-send:provider-watchdog:v4';

function expectAcquired(
  claim: Awaited<ReturnType<MessageSendIdempotencyService['claimOperation']>>
): asserts claim is IMessageSendAcquiredClaim {
  expect(claim).toMatchObject({ status: 'acquired', state: 'reserved' });
  if (claim.status !== 'acquired') {
    throw new Error(`Expected acquired claim, received ${claim.status}`);
  }
}

describe('MessageSendIdempotencyService v4 Redis watchdog', () => {
  integrationTest(
    'terminalizes only due provider invocations and compacts after exact PubAck CAS',
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
      const service = new MessageSendIdempotencyService(redis);
      const scope = randomUUID();
      const recoveryWorkerId = `watchdog-worker-${scope}`;
      const ledgerKeys: string[] = [];
      const recoveryKeys: string[] = [];
      const recoveryRecordKeys: string[] = [];

      try {
        await redis.connect();

        const claim = await service.claimOperation({
          accountId: `watchdog-account-${scope}`,
          operationType: 'direct',
          operationId: `watchdog-operation-${scope}`,
          meta: {
            provider: 'baileys',
            account_id: `watchdog-account-${scope}`,
            chat_id: `watchdog-chat-${scope}`,
            message_id: `watchdog-message-${scope}`,
            worker_id: recoveryWorkerId,
          },
        });
        expectAcquired(claim);
        ledgerKeys.push(claim.key);
        const recoveryKey = service.buildRecoveryKey(
          claim.accountId,
          claim.operationType,
          claim.operationId
        );
        if (!recoveryKey) {
          throw new Error('Expected recovery key');
        }
        recoveryKeys.push(recoveryKey);
        const recoveryRecordKey = service.buildRecoveryRecordKey(
          claim.accountId,
          claim.operationType,
          claim.operationId
        );
        if (recoveryRecordKey) recoveryRecordKeys.push(recoveryRecordKey);
        const recovery = {
          schema_version: 'message_send_ambiguous_terminal_v1',
          provider: 'baileys',
          operation_id: claim.operationId,
          outcome_digest: `watchdog-digest-${scope}`,
          status_update: {
            event_id: `watchdog-event-${scope}`,
            account_id: claim.accountId,
            worker_id: recoveryWorkerId,
            message_id: `watchdog-message-${scope}`,
            patch: {},
            failed: true,
          },
        };

        await expect(
          service.markProviderInvoked(claim, recovery, 150_000)
        ).resolves.toBe('transitioned');
        const indexedDue = await redis.zscore(WATCHDOG_KEY, claim.key);
        expect(indexedDue).not.toBeNull();
        expect(await redis.hget(claim.key, 'state')).toBe('provider_invoked');
        const invokedTtl = await redis.ttl(claim.key);
        expect(invokedTtl).toBeGreaterThan(0);
        expect(invokedTtl).toBeLessThanOrEqual(
          MESSAGE_SEND_LEDGER_V4_POLICY.providerInvokedTtlSeconds
        );

        const dueAt = Date.now() - 1;
        await redis
          .multi()
          .hset(claim.key, 'watchdog_due_at_ms', String(dueAt))
          .zadd(WATCHDOG_KEY, dueAt, claim.key)
          .exec();
        await expect(
          service.processProviderInvocationWatchdogBatch()
        ).resolves.toMatchObject({ terminalized: 1 });

        expect(await redis.hget(claim.key, 'state')).toBe('ambiguous');
        expect(await redis.hget(claim.key, 'error')).toBe(
          'provider_invocation_watchdog_expired'
        );
        expect(await redis.get(recoveryKey)).toBe(JSON.stringify(recovery));
        expect(await redis.zscore(WATCHDOG_KEY, claim.key)).toBeNull();
        const ambiguousTtl = await redis.ttl(claim.key);
        expect(ambiguousTtl).toBeGreaterThanOrEqual(
          MESSAGE_SEND_LEDGER_V4_POLICY.ambiguousTtlSeconds - 2
        );
        expect(ambiguousTtl).toBeLessThanOrEqual(
          MESSAGE_SEND_LEDGER_V4_POLICY.ambiguousTtlSeconds
        );
        await expect(
          service.markSucceeded(claim, { update_message: { event_id: 'late' } })
        ).resolves.toBe('invalid_state');

        const recoveryClaims = await service.claimGlobalRecoveryBatch();
        expect(recoveryClaims).toHaveLength(1);
        const [claimedAfterCrash] = recoveryClaims;
        expect(claimedAfterCrash?.plan.kind).toBe(
          'worker_global_publications_v1'
        );
        const step = claimedAfterCrash?.plan.steps[0];
        if (!claimedAfterCrash || !step) {
          throw new Error('Expected recovery claim');
        }
        const stepId =
          step.kind === 'kafka_publication_v1'
            ? step.publication_id
            : step.step_id;
        await expect(
          service.markRecoveryStepCompleted(claimedAfterCrash, stepId)
        ).resolves.toBe('transitioned');
        await expect(
          service.compactRecoveryClaimAfterPubAck(claimedAfterCrash)
        ).resolves.toBe('transitioned');
        expect(await redis.exists(claim.key)).toBe(1);
        expect(await redis.hget(claim.key, 'state')).toBe('ambiguous');
        expect(await redis.hget(claim.key, 'meta_json')).toBeNull();
        expect(await redis.get(recoveryKey)).toBeNull();
        await expect(
          service.compactTerminalAfterRecoveryPubAck(
            claim,
            'ambiguous',
            recovery
          )
        ).resolves.toBe('transitioned');
        await expect(
          service.compactTerminalAfterRecoveryPubAck(claim, 'ambiguous', {
            ...recovery,
            outcome_digest: `different-${scope}`,
          })
        ).resolves.toBe('invalid_state');

        const compactedPayloadFields = [
          'meta_json',
          'result_json',
          'recovery_json',
          'owner',
          'error',
        ] as const;
        await expect(
          redis.hmget(claim.key, ...compactedPayloadFields)
        ).resolves.toEqual(compactedPayloadFields.map(() => null));
        for (const field of compactedPayloadFields) {
          await expect(redis.hstrlen(claim.key, field)).resolves.toBe(0);
        }
        const tombstoneFields = await redis.hkeys(claim.key);
        const tombstoneContentBytes = (
          await Promise.all(
            tombstoneFields.map(
              async (field) =>
                Buffer.byteLength(field, 'utf8') +
                (await redis.hstrlen(claim.key, field))
            )
          )
        ).reduce((total, fieldBytes) => total + fieldBytes, 0);
        const tombstoneFieldCount = await redis.hlen(claim.key);
        expect(tombstoneFieldCount).toBe(tombstoneFields.length);
        expect(tombstoneFieldCount).toBeLessThanOrEqual(16);
        expect(tombstoneContentBytes).toBeLessThanOrEqual(1024);
        const tombstoneMemoryBytes = Number(
          await redis.call('MEMORY', 'USAGE', claim.key)
        );
        expect(tombstoneMemoryBytes).toBeGreaterThan(0);
        // Redis allocator/listpack capacity is implementation-dependent; the
        // bounded contract is the exact key/value content measured above via
        // HLEN/HSTRLEN, excluding allocator slack reported by MEMORY USAGE.

        const ledgerExpired = await service.claimOperation({
          accountId: `watchdog-account-${scope}`,
          operationType: 'direct',
          operationId: `ledger-expired-operation-${scope}`,
          meta: {
            provider: 'baileys',
            account_id: `watchdog-account-${scope}`,
            chat_id: `watchdog-chat-${scope}`,
            message_id: `ledger-expired-message-${scope}`,
            worker_id: recoveryWorkerId,
          },
        });
        expectAcquired(ledgerExpired);
        ledgerKeys.push(ledgerExpired.key);
        const ledgerExpiredRecoveryKey = service.buildRecoveryKey(
          ledgerExpired.accountId,
          ledgerExpired.operationType,
          ledgerExpired.operationId
        );
        if (ledgerExpiredRecoveryKey)
          recoveryKeys.push(ledgerExpiredRecoveryKey);
        const ledgerExpiredRecovery = {
          schema_version: 'message_send_ambiguous_terminal_v1',
          provider: 'baileys',
          operation_id: ledgerExpired.operationId,
          outcome_digest: `ledger-expired-digest-${scope}`,
          status_update: {
            event_id: `ledger-expired-event-${scope}`,
            account_id: ledgerExpired.accountId,
            worker_id: recoveryWorkerId,
            message_id: `ledger-expired-message-${scope}`,
            patch: {},
            failed: true,
          },
        };
        await expect(
          service.markProviderInvoked(
            ledgerExpired,
            ledgerExpiredRecovery,
            150_000
          )
        ).resolves.toBe('transitioned');
        await expect(
          service.markAmbiguous(
            ledgerExpired,
            new Error('provider outcome unknown'),
            ledgerExpiredRecovery
          )
        ).resolves.toBe('transitioned');
        const durableRecordKey = service.buildRecoveryRecordKey(
          ledgerExpired.accountId,
          ledgerExpired.operationType,
          ledgerExpired.operationId
        );
        if (!durableRecordKey) throw new Error('Expected recovery record key');
        recoveryRecordKeys.push(durableRecordKey);
        expect(await redis.ttl(durableRecordKey)).toBeGreaterThanOrEqual(
          MESSAGE_SEND_LEDGER_V4_POLICY.recoveryTtlSeconds - 2
        );
        // The projection record is independent from the shorter terminal
        // dedupe tombstone and remains drainable for the full recovery TTL.
        await redis.del(ledgerExpired.key);
        const [expiredLedgerClaim] = await service.claimGlobalRecoveryBatch();
        expect(expiredLedgerClaim).toMatchObject({
          ledgerKey: ledgerExpired.key,
          recoveryRecordKey: durableRecordKey,
          state: 'ambiguous',
          recovery: ledgerExpiredRecovery,
        });
        if (!expiredLedgerClaim) throw new Error('Expected durable recovery');
        for (const step of expiredLedgerClaim.plan.steps) {
          await expect(
            service.markRecoveryStepCompleted(
              expiredLedgerClaim,
              step.kind === 'kafka_publication_v1'
                ? step.publication_id
                : step.step_id
            )
          ).resolves.toBe('transitioned');
        }
        await expect(
          service.compactRecoveryClaimAfterPubAck(expiredLedgerClaim)
        ).resolves.toBe('transitioned');
        expect(await redis.exists(durableRecordKey)).toBe(0);

        const settled = await service.claimOperation({
          accountId: `watchdog-account-${scope}`,
          operationType: 'direct',
          operationId: `settled-operation-${scope}`,
          meta: {
            provider: 'baileys',
            account_id: `watchdog-account-${scope}`,
            chat_id: `watchdog-chat-${scope}`,
            message_id: `settled-message-${scope}`,
            worker_id: recoveryWorkerId,
          },
        });
        expectAcquired(settled);
        ledgerKeys.push(settled.key);
        const settledRecoveryKey = service.buildRecoveryKey(
          settled.accountId,
          settled.operationType,
          settled.operationId
        );
        if (settledRecoveryKey) {
          recoveryKeys.push(settledRecoveryKey);
        }
        await expect(service.markProviderInvoked(settled)).resolves.toBe(
          'transitioned'
        );
        await expect(service.markSucceeded(settled)).resolves.toBe(
          'transitioned'
        );
        await redis.zadd(WATCHDOG_KEY, dueAt, settled.key);
        await service.processProviderInvocationWatchdogBatch();
        expect(await redis.hget(settled.key, 'state')).toBe('succeeded');
        expect(await redis.zscore(WATCHDOG_KEY, settled.key)).toBeNull();
      } finally {
        if (redis.status === 'ready') {
          if (ledgerKeys.length > 0 || recoveryKeys.length > 0) {
            await redis.del(
              ...ledgerKeys,
              ...recoveryKeys,
              ...recoveryRecordKeys,
              `message-send:recovery:v4:${recoveryWorkerId}`
            );
            await redis.zrem(
              'message-send:recovery-workers:v4',
              recoveryWorkerId
            );
            if (ledgerKeys.length > 0) {
              await redis.zrem(WATCHDOG_KEY, ...ledgerKeys);
            }
          }
          await redis.quit().catch(() => redis.disconnect());
        } else {
          redis.disconnect();
        }
      }
    },
    20_000
  );
});
