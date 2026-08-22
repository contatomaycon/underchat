import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { WhatsappRuntimeFenceService } from '@core/services/whatsappRuntimeFence.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

describe('WhatsappRuntimeFenceService Redis integration', () => {
  integrationTest(
    'stays fail-closed during cutover and allows only the latest pending activation to finalize',
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
      const service = new WhatsappRuntimeFenceService(redis);
      const peerService = new WhatsappRuntimeFenceService(peerRedis);
      const workerId = `runtime-fence-${randomUUID()}`;
      const runtimeGeneration = 7;
      const epochA = `a-${randomUUID()}`;
      const epochB = `b-${randomUUID()}`;
      const epochC = `c-${randomUUID()}`;
      const keys = [
        WhatsappRuntimeFenceService.key(workerId),
        WhatsappRuntimeFenceService.activationLockKey(workerId),
        WhatsappRuntimeFenceService.activationOrdersKey(
          workerId,
          runtimeGeneration
        ),
        WhatsappRuntimeFenceService.effectLeasesKey(workerId),
        WhatsappRuntimeFenceService.effectLeaseOwnersKey(workerId),
      ];

      try {
        await Promise.all([redis.connect(), peerRedis.connect()]);

        const beginA = await service.beginActivation({
          worker_id: workerId,
          runtime_generation: runtimeGeneration,
          connection_epoch: epochA,
          source_provider: 'wwebjs',
        });
        expect(beginA.status).toBe('acquired');
        await expect(
          service.isCurrent({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochA,
            source_provider: 'wwebjs',
          })
        ).resolves.toBe(false);

        const beginB = await peerService.beginActivation({
          worker_id: workerId,
          runtime_generation: runtimeGeneration,
          connection_epoch: epochB,
          source_provider: 'wwebjs',
        });
        expect(beginB.status).toBe('waiting');
        expect(beginB.activation_order).toBeGreaterThan(
          beginA.activation_order
        );

        await expect(
          service.finalizeActivation({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochA,
            source_provider: 'wwebjs',
            activation_order: beginA.activation_order,
            connection_sequence: 1,
          })
        ).resolves.toBe(false);
        await expect(
          service.beginActivation({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochA,
            source_provider: 'wwebjs',
          })
        ).resolves.toMatchObject({ status: 'superseded' });

        await expect(
          peerService.beginActivation({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochB,
            source_provider: 'wwebjs',
          })
        ).resolves.toMatchObject({
          status: 'acquired',
          activation_order: beginB.activation_order,
        });
        await expect(
          peerService.finalizeActivation({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochB,
            source_provider: 'wwebjs',
            activation_order: beginB.activation_order,
            connection_sequence: 2,
          })
        ).resolves.toBe(true);
        await expect(peerService.view(workerId)).resolves.toMatchObject({
          state: 'active',
          connection_epoch: epochB,
          connection_sequence: 2,
          activation_order: beginB.activation_order,
        });

        const ordersKey = WhatsappRuntimeFenceService.activationOrdersKey(
          workerId,
          runtimeGeneration
        );
        const lease = await peerService.acquireEffectLease({
          worker_id: workerId,
          runtime_generation: runtimeGeneration,
          connection_epoch: epochB,
          source_provider: 'wwebjs',
        });
        expect(lease).not.toBeNull();
        await redis.del(ordersKey);
        const drainingC = await service.beginActivation({
          worker_id: workerId,
          runtime_generation: runtimeGeneration,
          connection_epoch: epochC,
          source_provider: 'wwebjs',
        });
        expect(drainingC).toMatchObject({
          status: 'draining',
          active_effect_leases: 1,
        });
        await expect(
          service.finalizeActivation({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochC,
            source_provider: 'wwebjs',
            activation_order: drainingC.activation_order,
            connection_sequence: 3,
          })
        ).resolves.toBe(false);
        await expect(
          peerService.acquireEffectLease({
            worker_id: workerId,
            runtime_generation: runtimeGeneration,
            connection_epoch: epochB,
            source_provider: 'wwebjs',
          })
        ).resolves.toBeNull();
        await expect(lease?.release()).resolves.toBe(true);
        await redis
          .multi()
          .zadd(
            WhatsappRuntimeFenceService.effectLeasesKey(workerId),
            Date.now() - 1_000,
            'expired-lease'
          )
          .hset(
            WhatsappRuntimeFenceService.effectLeaseOwnersKey(workerId),
            'expired-lease',
            'crashed-owner'
          )
          .exec();

        const beginC = await service.beginActivation({
          worker_id: workerId,
          runtime_generation: runtimeGeneration,
          connection_epoch: epochC,
          source_provider: 'wwebjs',
        });
        expect(beginC.status).toBe('acquired');
        expect(beginC.activation_order).toBe(drainingC.activation_order);
        expect(beginC.activation_order).toBeGreaterThan(
          beginB.activation_order
        );
        expect(
          await redis.zcard(
            WhatsappRuntimeFenceService.effectLeasesKey(workerId)
          )
        ).toBe(0);
        expect(
          await redis.hlen(
            WhatsappRuntimeFenceService.effectLeaseOwnersKey(workerId)
          )
        ).toBe(0);
        expect(await redis.ttl(ordersKey)).toBeGreaterThan(29 * 24 * 60 * 60);
        await expect(service.view(workerId)).resolves.toBeNull();
      } finally {
        try {
          const cleanupRedis = [redis, peerRedis].find(
            (client) => client.status === 'ready'
          );
          if (cleanupRedis) {
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

  integrationTest(
    'atomically orders cross-pod effect admission against a replacement activation',
    async () => {
      if (!redisUrl) {
        throw new Error(
          'TEST_REDIS_URL is required for Redis integration test'
        );
      }

      const redis = new Redis(redisUrl);
      const peerRedis = new Redis(redisUrl);
      const service = new WhatsappRuntimeFenceService(redis);
      const peerService = new WhatsappRuntimeFenceService(peerRedis);
      const workerId = `runtime-fence-race-${randomUUID()}`;
      const activeEpoch = `active-${randomUUID()}`;
      const replacementEpoch = `replacement-${randomUUID()}`;
      const event = {
        worker_id: workerId,
        runtime_generation: 11,
        connection_epoch: activeEpoch,
        source_provider: 'whatsmeow' as const,
      };
      const keys = [
        WhatsappRuntimeFenceService.key(workerId),
        WhatsappRuntimeFenceService.activationLockKey(workerId),
        WhatsappRuntimeFenceService.activationOrdersKey(workerId, 11),
        WhatsappRuntimeFenceService.effectLeasesKey(workerId),
        WhatsappRuntimeFenceService.effectLeaseOwnersKey(workerId),
      ];

      try {
        const begin = await service.beginActivation(event);
        expect(begin.status).toBe('acquired');
        await expect(
          service.finalizeActivation({
            ...event,
            activation_order: begin.activation_order,
            connection_sequence: 1,
          })
        ).resolves.toBe(true);

        const [lease, replacement] = await Promise.all([
          service.acquireEffectLease(event),
          peerService.beginActivation({
            ...event,
            connection_epoch: replacementEpoch,
          }),
        ]);

        expect(lease !== null && replacement.status === 'acquired').toBe(false);
        if (lease) {
          expect(replacement.status).toBe('draining');
          await lease.release();
        } else {
          expect(replacement.status).toBe('acquired');
        }
      } finally {
        await redis.del(...keys).catch(() => undefined);
        await Promise.all([
          redis.quit().catch(() => redis.disconnect()),
          peerRedis.quit().catch(() => peerRedis.disconnect()),
        ]);
      }
    },
    20_000
  );
});
