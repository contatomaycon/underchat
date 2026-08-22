import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  ScheduleMessageInFlightLeaseUnavailableError,
  ScheduleStatusCoordinationService,
} from '@core/services/scheduleStatusCoordination.service';
import { MessageSendIdempotencyService } from '@core/services/messageSendIdempotency.service';
import { buildScheduleSendAmbiguousRecovery } from '@core/common/functions/outboundAuxiliarySendRecovery';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

describe('ScheduleStatusCoordinationService Redis integration', () => {
  integrationTest(
    'terminalizes a ledger-proven provider outcome before a divergent attempt lease without resending',
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
      const peerRedis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const coordination = new ScheduleStatusCoordinationService(redis);
      const peerCoordination = new ScheduleStatusCoordinationService(peerRedis);
      const ledger = new MessageSendIdempotencyService(redis);
      const suffix = randomUUID();
      const originalIdentity = {
        scheduleId: `schedule-ledger-${suffix}`,
        accountId: `account-ledger-${suffix}`,
        workerId: `worker-ledger-${suffix}`,
        messageId: `message-ledger-${suffix}`,
        attemptId: `attempt-original-${suffix}`,
      };
      const replacementIdentity = {
        ...originalIdentity,
        attemptId: `attempt-replacement-${suffix}`,
      };
      const stableMeta = {
        provider: 'baileys',
        account_id: originalIdentity.accountId,
        chat_id: `chat-ledger-${suffix}`,
        message_id: originalIdentity.messageId,
        worker_id: originalIdentity.workerId,
        schedule_id: originalIdentity.scheduleId,
        contact_id: `contact-ledger-${suffix}`,
      };
      const legacyMeta = {
        ...stableMeta,
        attempt_id: originalIdentity.attemptId,
      };
      const recovery = buildScheduleSendAmbiguousRecovery({
        provider: 'baileys',
        operationId: originalIdentity.messageId,
        scheduleId: originalIdentity.scheduleId,
        contactId: stableMeta.contact_id,
        messageId: originalIdentity.messageId,
        attemptId: originalIdentity.attemptId,
        accountId: originalIdentity.accountId,
        workerId: originalIdentity.workerId,
      });
      const attemptKey = `{schedule-status}:message-attempt:v3:${originalIdentity.scheduleId}:${originalIdentity.messageId}`;
      const deadlineKey = '{schedule-status}:reconciliation:v2:deadlines';
      const deadlineVersionKey = '{schedule-status}:reconciliation:v2:versions';
      const ledgerKey = ledger.buildOperationKey(
        originalIdentity.accountId,
        'schedule',
        originalIdentity.messageId
      );

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);
        await expect(
          coordination.queueMessageAttempt(originalIdentity)
        ).resolves.toBe('queued');

        const claim = await ledger.claimOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: legacyMeta,
        });
        expect(claim.status).toBe('acquired');
        if (claim.status !== 'acquired') {
          throw new Error('Expected the provider ledger claim');
        }
        await expect(ledger.markProviderInvoked(claim, recovery)).resolves.toBe(
          'transitioned'
        );

        const inspection = await ledger.inspectOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: stableMeta,
          compatibleLegacyMetaKeys: ['attempt_id'],
        });
        expect(inspection).toMatchObject({
          status: 'duplicate',
          state: 'provider_invoked',
          operationId: originalIdentity.messageId,
          result: recovery,
        });
        if (inspection.status !== 'duplicate') {
          throw new Error('Expected the durable provider outcome');
        }

        await expect(
          peerCoordination.setMessageOperationalStateFromLedger(
            {
              ...replacementIdentity,
              ledgerOperationId: inspection.operationId,
            },
            'ambiguous'
          )
        ).resolves.toBe('transitioned');
        await expect(
          coordination.getMessageOperationalState(originalIdentity)
        ).resolves.toBe('ambiguous');
        await expect(
          peerCoordination.withMessageInFlight(
            replacementIdentity,
            async () => {
              throw new Error('provider_must_not_be_invoked');
            }
          )
        ).rejects.toBeInstanceOf(ScheduleMessageInFlightLeaseUnavailableError);
        await expect(redis.hgetall(attemptKey)).resolves.toEqual(
          expect.objectContaining({
            attempt_id: originalIdentity.attemptId,
            operational_state: 'ambiguous',
            ledger_operation_id: originalIdentity.messageId,
          })
        );
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (cleanupRedis) {
            const cleanup = cleanupRedis
              .multi()
              .del(attemptKey)
              .zrem(deadlineKey, originalIdentity.scheduleId)
              .hdel(deadlineVersionKey, originalIdentity.scheduleId);
            if (ledgerKey) {
              cleanup.del(ledgerKey);
            }
            await cleanup.exec();
          }
        } finally {
          await Promise.all(
            [redis, peerRedis].map(async (client) => {
              if (client.status === 'ready') {
                await client.quit().catch(() => client.disconnect());
              } else {
                client.disconnect();
              }
            })
          );
        }
      }
    },
    20_000
  );

  integrationTest(
    'recovers an official reserved crash with a short lease and adopts the divergent attempt without a duplicate provider call',
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
      const peerRedis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const coordination = new ScheduleStatusCoordinationService(redis);
      const peerCoordination = new ScheduleStatusCoordinationService(peerRedis);
      const ledger = new MessageSendIdempotencyService(redis);
      const suffix = randomUUID();
      const originalIdentity = {
        scheduleId: `schedule-official-reserved-${suffix}`,
        accountId: `account-official-reserved-${suffix}`,
        workerId: `worker-official-reserved-${suffix}`,
        messageId: `message-official-reserved-${suffix}`,
        attemptId: `attempt-official-original-${suffix}`,
      };
      const replacementIdentity = {
        ...originalIdentity,
        attemptId: `attempt-official-replacement-${suffix}`,
      };
      const stableMeta = {
        provider: 'official',
        account_id: originalIdentity.accountId,
        chat_id: `chat-official-reserved-${suffix}`,
        message_id: originalIdentity.messageId,
        worker_id: originalIdentity.workerId,
        schedule_id: originalIdentity.scheduleId,
        contact_id: `contact-official-reserved-${suffix}`,
      };
      const recovery = buildScheduleSendAmbiguousRecovery({
        provider: 'official',
        operationId: originalIdentity.messageId,
        scheduleId: originalIdentity.scheduleId,
        contactId: stableMeta.contact_id,
        messageId: originalIdentity.messageId,
        attemptId: replacementIdentity.attemptId,
        accountId: originalIdentity.accountId,
        workerId: originalIdentity.workerId,
      });
      const attemptKey = `{schedule-status}:message-attempt:v3:${originalIdentity.scheduleId}:${originalIdentity.messageId}`;
      const deadlineKey = '{schedule-status}:reconciliation:v2:deadlines';
      const deadlineVersionKey = '{schedule-status}:reconciliation:v2:versions';
      const ledgerKey = ledger.buildOperationKey(
        originalIdentity.accountId,
        'schedule',
        originalIdentity.messageId
      );
      let providerCalls = 0;

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);
        await expect(
          coordination.queueMessageAttempt(originalIdentity)
        ).resolves.toBe('queued');

        const oldClaim = await ledger.claimOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: stableMeta,
          reservationLeaseMs:
            MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
        });
        expect(oldClaim.status).toBe('acquired');
        if (oldClaim.status !== 'acquired') {
          throw new Error('Expected the original official reservation');
        }
        const leaseRemaining =
          Number(await redis.hget(oldClaim.key, 'lease_until_ms')) - Date.now();
        expect(leaseRemaining).toBeGreaterThan(5_000);
        expect(leaseRemaining).toBeLessThanOrEqual(
          MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS
        );

        await expect(
          ledger.claimOperation({
            accountId: originalIdentity.accountId,
            operationType: 'schedule',
            operationId: originalIdentity.messageId,
            meta: stableMeta,
            reservationLeaseMs:
              MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
          })
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'reserved',
        });

        await redis.hset(oldClaim.key, 'lease_until_ms', '1');
        const replacementClaim = await ledger.claimOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: stableMeta,
          reservationLeaseMs:
            MessageSendIdempotencyService.FAST_RECOVERY_RESERVATION_LEASE_MS,
        });
        expect(replacementClaim.status).toBe('acquired');
        if (replacementClaim.status !== 'acquired') {
          throw new Error('Expected the official replacement reservation');
        }

        await expect(
          ledger.markProviderInvoked(oldClaim, recovery)
        ).resolves.toBe('owner_mismatch');
        await expect(
          peerCoordination.adoptMessageAttemptFromLedgerReservation({
            ...replacementIdentity,
            ledgerOperationId: replacementClaim.operationId,
            ledgerReservationOwner: replacementClaim.owner,
          })
        ).resolves.toBe('transitioned');

        await expect(
          peerCoordination.withMessageInFlight(
            replacementIdentity,
            async () => {
              const boundary = await ledger.markProviderInvoked(
                replacementClaim,
                recovery
              );
              expect(boundary).toBe('transitioned');
              if (boundary !== 'transitioned') {
                return;
              }
              providerCalls += 1;
              await expect(
                ledger.markSucceeded(replacementClaim, {
                  provider_message_id: `wamid.${suffix}`,
                })
              ).resolves.toBe('transitioned');
              await expect(
                peerCoordination.setMessageOperationalState(
                  replacementIdentity,
                  'succeeded'
                )
              ).resolves.toBe('transitioned');
            }
          )
        ).resolves.toBeUndefined();

        expect(providerCalls).toBe(1);
        await expect(
          coordination.getMessageOperationalState(replacementIdentity)
        ).resolves.toBe('succeeded');
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (cleanupRedis) {
            const cleanup = cleanupRedis
              .multi()
              .del(attemptKey)
              .zrem(deadlineKey, originalIdentity.scheduleId)
              .hdel(deadlineVersionKey, originalIdentity.scheduleId);
            if (ledgerKey) {
              cleanup.del(ledgerKey);
            }
            await cleanup.exec();
          }
        } finally {
          await Promise.all(
            [redis, peerRedis].map(async (client) => {
              if (client.status === 'ready') {
                await client.quit().catch(() => client.disconnect());
              } else {
                client.disconnect();
              }
            })
          );
        }
      }
    },
    20_000
  );

  integrationTest(
    'takes over a stale reserved runtime in seconds while preventing both the current and replaced owners from duplicating the provider call',
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
      const peerRedis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const coordination = new ScheduleStatusCoordinationService(redis);
      const peerCoordination = new ScheduleStatusCoordinationService(peerRedis);
      const ledger = new MessageSendIdempotencyService(redis);
      const runtimeFence = new WhatsappRuntimeFenceService(redis);
      const suffix = randomUUID();
      const originalIdentity = {
        scheduleId: `schedule-reserved-${suffix}`,
        accountId: `account-reserved-${suffix}`,
        workerId: `worker-reserved-${suffix}`,
        messageId: `message-reserved-${suffix}`,
        attemptId: `attempt-original-${suffix}`,
      };
      const replacementIdentity = {
        ...originalIdentity,
        attemptId: `attempt-replacement-${suffix}`,
      };
      const oldRuntime = {
        worker_id: originalIdentity.workerId,
        runtime_generation: 1,
        connection_epoch: `epoch-old-${suffix}`,
        connection_sequence: 1,
        source_provider: 'baileys' as const,
        activated_at: Date.now(),
      };
      const replacementRuntime = {
        ...oldRuntime,
        runtime_generation: 2,
        connection_epoch: `epoch-replacement-${suffix}`,
        connection_sequence: 2,
      };
      const stableMeta = {
        provider: 'baileys',
        account_id: originalIdentity.accountId,
        chat_id: `chat-reserved-${suffix}`,
        message_id: originalIdentity.messageId,
        worker_id: originalIdentity.workerId,
        schedule_id: originalIdentity.scheduleId,
        contact_id: `contact-reserved-${suffix}`,
      };
      const oldMeta = {
        ...stableMeta,
        runtime_generation: oldRuntime.runtime_generation,
        connection_epoch: oldRuntime.connection_epoch,
        consumer_assignment_epoch: 11,
      };
      const replacementMeta = {
        ...stableMeta,
        runtime_generation: replacementRuntime.runtime_generation,
        connection_epoch: replacementRuntime.connection_epoch,
        consumer_assignment_epoch: 12,
      };
      const recovery = buildScheduleSendAmbiguousRecovery({
        provider: 'baileys',
        operationId: originalIdentity.messageId,
        scheduleId: originalIdentity.scheduleId,
        contactId: stableMeta.contact_id,
        messageId: originalIdentity.messageId,
        attemptId: replacementIdentity.attemptId,
        accountId: originalIdentity.accountId,
        workerId: originalIdentity.workerId,
      });
      const runtimeFenceKey = WhatsappRuntimeFenceService.key(
        originalIdentity.workerId
      );
      const attemptKey = `{schedule-status}:message-attempt:v3:${originalIdentity.scheduleId}:${originalIdentity.messageId}`;
      const deadlineKey = '{schedule-status}:reconciliation:v2:deadlines';
      const deadlineVersionKey = '{schedule-status}:reconciliation:v2:versions';
      const ledgerKey = ledger.buildOperationKey(
        originalIdentity.accountId,
        'schedule',
        originalIdentity.messageId
      );
      let providerCalls = 0;

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);
        await expect(runtimeFence.activate(oldRuntime)).resolves.toBe(true);
        await expect(
          coordination.queueMessageAttempt(originalIdentity)
        ).resolves.toBe('queued');

        const oldClaim = await ledger.claimOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: oldMeta,
          runtimeFenceKey,
          reservationLeaseMs: MessageSendIdempotencyService.LEASE_MS,
        });
        expect(oldClaim.status).toBe('acquired');
        if (oldClaim.status !== 'acquired') {
          throw new Error('Expected the original reserved owner');
        }
        const originalLeaseUntil = Number(
          await redis.hget(oldClaim.key, 'lease_until_ms')
        );
        expect(originalLeaseUntil).toBeGreaterThan(Date.now() + 60_000);

        await expect(
          ledger.claimOperation({
            accountId: originalIdentity.accountId,
            operationType: 'schedule',
            operationId: originalIdentity.messageId,
            meta: oldMeta,
            runtimeFenceKey,
            reservationLeaseMs: MessageSendIdempotencyService.LEASE_MS,
          })
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'reserved',
        });

        await expect(runtimeFence.activate(replacementRuntime)).resolves.toBe(
          true
        );
        const takeoverStartedAt = Date.now();
        const replacementClaim = await ledger.claimOperation({
          accountId: originalIdentity.accountId,
          operationType: 'schedule',
          operationId: originalIdentity.messageId,
          meta: replacementMeta,
          runtimeFenceKey,
        });
        expect(Date.now() - takeoverStartedAt).toBeLessThan(5_000);
        expect(replacementClaim.status).toBe('acquired');
        if (replacementClaim.status !== 'acquired') {
          throw new Error('Expected the replacement reserved owner');
        }
        expect(replacementClaim.owner).not.toBe(oldClaim.owner);

        await expect(
          ledger.markProviderInvoked(oldClaim, recovery)
        ).resolves.toBe('owner_mismatch');
        expect(providerCalls).toBe(0);

        await expect(
          peerCoordination.adoptMessageAttemptFromLedgerReservation({
            ...replacementIdentity,
            ledgerOperationId: replacementClaim.operationId,
            ledgerReservationOwner: replacementClaim.owner,
          })
        ).resolves.toBe('transitioned');
        await expect(redis.hgetall(attemptKey)).resolves.toEqual(
          expect.objectContaining({
            state: 'grace',
            attempt_id: replacementIdentity.attemptId,
            owner: '',
            lease_until_ms: '0',
            operational_state: 'pending',
            ledger_operation_id: replacementClaim.operationId,
            ledger_reservation_owner: replacementClaim.owner,
          })
        );

        await expect(
          peerCoordination.withMessageInFlight(
            replacementIdentity,
            async (assertOwned) => {
              await assertOwned();
              const boundary = await ledger.markProviderInvoked(
                replacementClaim,
                recovery
              );
              expect(boundary).toBe('transitioned');
              if (boundary !== 'transitioned') {
                return;
              }
              providerCalls += 1;
              await expect(
                ledger.markSucceeded(replacementClaim, {
                  provider_message_id: `provider-${suffix}`,
                })
              ).resolves.toBe('transitioned');
              await expect(
                peerCoordination.setMessageOperationalState(
                  replacementIdentity,
                  'succeeded'
                )
              ).resolves.toBe('transitioned');
            }
          )
        ).resolves.toBeUndefined();

        await expect(
          ledger.claimOperation({
            accountId: originalIdentity.accountId,
            operationType: 'schedule',
            operationId: originalIdentity.messageId,
            meta: replacementMeta,
            runtimeFenceKey,
          })
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'succeeded',
        });
        await expect(
          ledger.markProviderInvoked(oldClaim, recovery)
        ).resolves.toBe('owner_mismatch');
        expect(providerCalls).toBe(1);
        await expect(
          coordination.getMessageOperationalState(replacementIdentity)
        ).resolves.toBe('succeeded');
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (cleanupRedis) {
            const cleanup = cleanupRedis
              .multi()
              .del(
                attemptKey,
                runtimeFenceKey,
                WhatsappRuntimeFenceService.activationLockKey(
                  originalIdentity.workerId
                ),
                WhatsappRuntimeFenceService.activationOrdersKey(
                  originalIdentity.workerId,
                  oldRuntime.runtime_generation
                ),
                WhatsappRuntimeFenceService.activationOrdersKey(
                  originalIdentity.workerId,
                  replacementRuntime.runtime_generation
                ),
                WhatsappRuntimeFenceService.effectLeasesKey(
                  originalIdentity.workerId
                ),
                WhatsappRuntimeFenceService.effectLeaseOwnersKey(
                  originalIdentity.workerId
                )
              )
              .zrem(deadlineKey, originalIdentity.scheduleId)
              .hdel(deadlineVersionKey, originalIdentity.scheduleId);
            if (ledgerKey) {
              cleanup.del(ledgerKey);
            }
            await cleanup.exec();
          }
        } finally {
          await Promise.all(
            [redis, peerRedis].map(async (client) => {
              if (client.status === 'ready') {
                await client.quit().catch(() => client.disconnect());
              } else {
                client.disconnect();
              }
            })
          );
        }
      }
    },
    20_000
  );

  integrationTest(
    'coordinates operational state and an in-flight attempt across pods',
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
      const peerRedis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const service = new ScheduleStatusCoordinationService(redis);
      const peerService = new ScheduleStatusCoordinationService(peerRedis);
      const suffix = randomUUID();
      const scheduleId = `schedule-${suffix}`;
      const identity = {
        scheduleId,
        accountId: `account-${suffix}`,
        workerId: `worker-${suffix}`,
        messageId: `message-${suffix}`,
        attemptId: `attempt-${suffix}`,
      };
      const inFlightIdentity = {
        ...identity,
        messageId: `in-flight-message-${suffix}`,
        attemptId: `in-flight-attempt-${suffix}`,
      };
      const reopenedIdentity = {
        ...identity,
        messageId: `reopened-message-${suffix}`,
        attemptId: `reopened-attempt-${suffix}`,
      };
      const attemptKey = `{schedule-status}:message-attempt:v3:${scheduleId}:${identity.messageId}`;
      const inFlightAttemptKey = `{schedule-status}:message-attempt:v3:${scheduleId}:${inFlightIdentity.messageId}`;
      const reopenedAttemptKey = `{schedule-status}:message-attempt:v3:${scheduleId}:${reopenedIdentity.messageId}`;
      const deadlineKey = '{schedule-status}:reconciliation:v2:deadlines';
      const deadlineVersionKey = '{schedule-status}:reconciliation:v2:versions';

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);

        await expect(service.queueMessageAttempt(identity)).resolves.toBe(
          'queued'
        );
        await expect(
          peerService.getMessageOperationalState(identity)
        ).resolves.toBe('pending');

        await expect(
          peerService.setMessageOperationalState(identity, 'ambiguous')
        ).resolves.toBe('transitioned');
        await expect(
          service.setMessageOperationalState(identity, 'pre_provider_failed')
        ).resolves.toBe('invalid');
        await expect(
          service.setMessageOperationalState(identity, 'succeeded')
        ).resolves.toBe('transitioned');
        await expect(
          peerService.setMessageOperationalState(identity, 'ambiguous')
        ).resolves.toBe('invalid');
        await expect(
          service.getMessageOperationalState(identity)
        ).resolves.toBe('succeeded');

        await expect(
          peerService.setMessageOperationalState(
            { ...identity, workerId: `other-worker-${suffix}` },
            'succeeded'
          )
        ).resolves.toBe('stale');
        await expect(
          peerService.getMessageOperationalState({
            ...identity,
            workerId: `other-worker-${suffix}`,
          })
        ).resolves.toBeNull();

        await expect(
          service.queueMessageAttempt(inFlightIdentity)
        ).resolves.toBe('queued');
        let enterFirst!: () => void;
        const enteredFirst = new Promise<void>((resolve) => {
          enterFirst = resolve;
        });
        let releaseFirst!: () => void;
        const firstMayFinish = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        const first = service.withMessageInFlight(
          inFlightIdentity,
          async () => {
            enterFirst();
            await firstMayFinish;
          }
        );
        await enteredFirst;

        try {
          await expect(
            peerService.withMessageInFlight(
              inFlightIdentity,
              async () => undefined
            )
          ).rejects.toBeInstanceOf(
            ScheduleMessageInFlightLeaseUnavailableError
          );
        } finally {
          releaseFirst();
          await first;
        }

        await expect(
          service.queueMessageAttempt(reopenedIdentity)
        ).resolves.toBe('queued');
        await expect(
          service.setMessageOperationalState(reopenedIdentity, 'ambiguous')
        ).resolves.toBe('transitioned');
        await redis.hset(reopenedAttemptKey, 'lease_until_ms', '1');
        const ambiguousClaim =
          await peerService.claimMessageAttemptForReconciliation(
            reopenedIdentity
          );
        expect(ambiguousClaim.state).toBe('acquired');
        if (ambiguousClaim.state !== 'acquired') {
          throw new Error('Expected the ambiguous attempt lease');
        }
        await expect(
          peerService.completeMessageAttemptLease(
            ambiguousClaim.lease,
            'ambiguous'
          )
        ).resolves.toBe(true);
        await expect(
          service.claimMessageAttemptForReconciliation(reopenedIdentity)
        ).resolves.toEqual({ state: 'completed' });

        await expect(
          service.setMessageOperationalState(reopenedIdentity, 'succeeded')
        ).resolves.toBe('transitioned');
        const succeededClaim =
          await peerService.claimMessageAttemptForReconciliation(
            reopenedIdentity
          );
        expect(succeededClaim.state).toBe('acquired');
        if (succeededClaim.state !== 'acquired') {
          throw new Error('Expected the succeeded attempt lease');
        }
        await expect(
          peerService.completeMessageAttemptLease(
            succeededClaim.lease,
            'succeeded'
          )
        ).resolves.toBe(true);
        await expect(redis.hgetall(reopenedAttemptKey)).resolves.toEqual(
          expect.objectContaining({
            state: 'completed',
            operational_state: 'succeeded',
            reconciled_operational_state: 'succeeded',
          })
        );
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (cleanupRedis) {
            await cleanupRedis
              .multi()
              .del(attemptKey, inFlightAttemptKey, reopenedAttemptKey)
              .zrem(deadlineKey, scheduleId)
              .hdel(deadlineVersionKey, scheduleId)
              .exec();
          }
        } finally {
          await Promise.all(
            [redis, peerRedis].map(async (client) => {
              if (client.status === 'ready') {
                await client.quit().catch(() => client.disconnect());
              } else {
                client.disconnect();
              }
            })
          );
        }
      }
    },
    20_000
  );
});
