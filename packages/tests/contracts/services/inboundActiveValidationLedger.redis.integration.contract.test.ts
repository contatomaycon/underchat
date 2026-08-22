import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import {
  IInboundActiveValidationAcquiredClaim,
  IInboundActiveValidationClaimInput,
  InboundActiveValidationClaimResult,
  InboundActiveValidationLedgerService,
} from '@core/services/inboundActiveValidationLedger.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

function expectAcquired(
  claim: InboundActiveValidationClaimResult
): asserts claim is IInboundActiveValidationAcquiredClaim {
  expect(claim).toMatchObject({
    status: 'acquired',
    state: 'reserved',
  });
  if (claim.status !== 'acquired') {
    throw new Error(`Expected an acquired claim, received ${claim.status}`);
  }
}

describe('InboundActiveValidationLedgerService Redis integration', () => {
  integrationTest(
    'enforces claims, owner CAS, terminal states, release and seven-day TTL atomically',
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
      const service = new InboundActiveValidationLedgerService(redis);
      const peerService = new InboundActiveValidationLedgerService(peerRedis);
      const keys = new Set<string>();
      const scope = randomUUID();
      const input = (suffix: string): IInboundActiveValidationClaimInput => {
        const claimInput = {
          accountId: `redis-integration-account-${scope}`,
          workerId: `redis-integration-worker-${scope}`,
          eventId: `waevt_v1_redis-integration-${scope}-${suffix}`,
        };
        const key = service.buildKey(claimInput);
        if (!key) {
          throw new Error('Expected a valid integration ledger key');
        }
        keys.add(key);
        return claimInput;
      };

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);

        const concurrentInput = input('concurrent');
        const concurrentClaims = await Promise.all([
          service.claim(concurrentInput),
          peerService.claim(concurrentInput),
        ]);
        expect(concurrentClaims.map((claim) => claim.status).sort()).toEqual([
          'acquired',
          'duplicate',
        ]);

        const acquired = concurrentClaims.find(
          (claim) => claim.status === 'acquired'
        );
        if (!acquired) {
          throw new Error('Concurrent claim did not produce an owner');
        }
        expectAcquired(acquired);

        await expect(
          service.markHandled({
            ...acquired,
            owner: `wrong-owner-${scope}`,
          })
        ).resolves.toBe('owner_mismatch');
        await expect(service.markHandled(acquired)).resolves.toBe(
          'transitioned'
        );
        await expect(service.claim(concurrentInput)).resolves.toMatchObject({
          status: 'duplicate',
          state: 'handled',
          owner: null,
        });

        const handledTtl = await redis.ttl(acquired.key);
        expect(handledTtl).toBeGreaterThanOrEqual(
          InboundActiveValidationLedgerService.TTL_SECONDS - 2
        );
        expect(handledTtl).toBeLessThanOrEqual(
          InboundActiveValidationLedgerService.TTL_SECONDS
        );

        const releaseInput = input('release');
        const firstReleaseClaim = await service.claim(releaseInput);
        expectAcquired(firstReleaseClaim);
        await expect(service.release(firstReleaseClaim)).resolves.toBe(
          'transitioned'
        );
        await expect(redis.exists(firstReleaseClaim.key)).resolves.toBe(0);

        const reacquired = await service.claim(releaseInput);
        expectAcquired(reacquired);
        expect(reacquired.owner).not.toBe(firstReleaseClaim.owner);
        await expect(
          service.markAmbiguous(
            reacquired,
            new Error('provider outcome is intentionally uncertain')
          )
        ).resolves.toBe('transitioned');
        await expect(service.claim(releaseInput)).resolves.toMatchObject({
          status: 'duplicate',
          state: 'ambiguous',
          owner: null,
        });

        const ambiguousRecord = await redis.hgetall(reacquired.key);
        expect(ambiguousRecord).toMatchObject({
          state: 'ambiguous',
          owner: '',
          error: 'provider outcome is intentionally uncertain',
        });
        const ambiguousTtl = await redis.ttl(reacquired.key);
        expect(ambiguousTtl).toBeGreaterThanOrEqual(
          InboundActiveValidationLedgerService.TTL_SECONDS - 2
        );
        expect(ambiguousTtl).toBeLessThanOrEqual(
          InboundActiveValidationLedgerService.TTL_SECONDS
        );
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
