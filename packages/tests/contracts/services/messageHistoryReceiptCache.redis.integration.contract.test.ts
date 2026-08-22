import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import {
  IMessageHistoryReceiptClaim,
  MessageHistoryReceiptCacheService,
} from '@core/services/messageHistoryReceiptCache.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

function historyEvent(scope: string, suffix: string): IUpsertMessage {
  return {
    account_id: `history-receipt-account-${scope}`,
    worker_id: `history-receipt-worker-${scope}`,
    event_id: `waevt_v1_history-receipt-${scope}-${suffix}`,
  } as IUpsertMessage;
}

function expectAcquired(
  reservation: Awaited<
    ReturnType<MessageHistoryReceiptCacheService['reserveForHistory']>
  >
): asserts reservation is {
  status: 'acquired';
  claim: IMessageHistoryReceiptClaim;
} {
  expect(reservation.status).toBe('acquired');
  if (reservation.status !== 'acquired') {
    throw new Error('Expected an acquired history receipt');
  }
}

describe('MessageHistoryReceiptCacheService Redis integration', () => {
  integrationTest(
    'atomically recovers only expired reservations and fences publication intent',
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
      const service = new MessageHistoryReceiptCacheService(redis, {
        inflightTtlSeconds: 60,
      });
      const peerService = new MessageHistoryReceiptCacheService(peerRedis, {
        inflightTtlSeconds: 60,
      });
      const keys = new Set<string>();
      const scope = randomUUID();

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);

        const takeoverEvent = historyEvent(scope, 'takeover');
        const first = await service.reserveForHistory(takeoverEvent);
        expectAcquired(first);
        keys.add(first.claim.key);
        await expect(
          peerService.reserveForHistory(takeoverEvent)
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'reserved',
        });

        await redis.hset(first.claim.key, 'lease_until_ms', '1');
        await expect(service.markPublishing(first.claim)).resolves.toBe(
          'lease_expired'
        );
        const takeover = await peerService.reserveForHistory(takeoverEvent);
        expectAcquired(takeover);
        expect(takeover.claim.owner).not.toBe(first.claim.owner);
        await expect(service.markPublishing(first.claim)).resolves.toBe(
          'owner_mismatch'
        );
        await expect(service.markPublished(first.claim)).resolves.toBe(
          'owner_mismatch'
        );
        await expect(
          service.markKnownFromReservation(first.claim)
        ).resolves.toBe('owner_mismatch');
        await expect(
          service.markAmbiguous(first.claim, new Error('stale owner'))
        ).resolves.toBe('owner_mismatch');
        await expect(peerService.markPublishing(takeover.claim)).resolves.toBe(
          'transitioned'
        );

        await redis.hset(takeover.claim.key, 'lease_until_ms', '1');
        await expect(
          service.reserveForHistory(takeoverEvent)
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'publishing',
        });
        await expect(peerService.markPublished(takeover.claim)).resolves.toBe(
          'transitioned'
        );
        await expect(
          service.reserveForHistory(takeoverEvent)
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'published',
        });

        const knownEvent = historyEvent(scope, 'known');
        const knownReservation = await service.reserveForHistory(knownEvent);
        expectAcquired(knownReservation);
        keys.add(knownReservation.claim.key);
        await service.markKnown(knownEvent);
        await redis.hset(knownReservation.claim.key, 'lease_until_ms', '1');
        await expect(
          peerService.reserveForHistory(knownEvent)
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'known',
        });

        const ambiguousEvent = historyEvent(scope, 'ambiguous');
        const ambiguousReservation =
          await service.reserveForHistory(ambiguousEvent);
        expectAcquired(ambiguousReservation);
        keys.add(ambiguousReservation.claim.key);
        await expect(
          service.markPublishing(ambiguousReservation.claim)
        ).resolves.toBe('transitioned');
        await expect(
          service.markAmbiguous(
            ambiguousReservation.claim,
            new Error('ack outcome unknown')
          )
        ).resolves.toBe('transitioned');
        await redis.hset(ambiguousReservation.claim.key, 'lease_until_ms', '1');
        await expect(
          peerService.reserveForHistory(ambiguousEvent)
        ).resolves.toMatchObject({
          status: 'duplicate',
          state: 'ambiguous',
        });

        const record = await redis.hgetall(takeover.claim.key);
        expect(record).toMatchObject({
          schema_version: '3',
          state: 'published',
          owner: '',
          event_id: takeover.claim.eventId,
        });
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (keys.size > 0) {
            if (!cleanupRedis) {
              throw new Error('Redis unavailable for integration key cleanup');
            }
            await cleanupRedis.del(...keys);
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
