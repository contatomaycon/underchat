import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { WorkerCommandLaneService } from '@core/services/workerCommandLane.service';

const redisUrl = process.env.TEST_REDIS_URL?.trim();
const integrationTest = redisUrl ? it : it.skip;

describe('WorkerCommandLaneService Redis transitive ordering', () => {
  integrationTest(
    'keeps a successor ready after its terminal predecessor is compacted',
    async () => {
      if (!redisUrl) throw new Error('TEST_REDIS_URL is required');
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const lanes = new WorkerCommandLaneService(redis);
      const scope = randomUUID();
      const accountId = `lane-compact-account-${scope}`;
      const workerId = `lane-compact-worker-${scope}`;
      const entityKey = `chat:${scope}`;
      const laneKey = lanes.buildLaneKey(accountId, workerId, entityKey);
      const operations = [0, 1, 2].map(
        (index) => `lane-compact-operation-${index}-${scope}`
      );
      const commands = [0, 1, 2].map(
        (index) => `lane-compact-command-${index}-${scope}`
      );
      const [firstOperation, secondOperation, thirdOperation] = operations;
      const [firstCommand, secondCommand, thirdCommand] = commands;
      if (
        !firstOperation ||
        !secondOperation ||
        !thirdOperation ||
        !firstCommand ||
        !secondCommand ||
        !thirdCommand
      ) {
        throw new Error('worker_command_lane_test_identity_missing');
      }
      const issuedAt = new Date(Date.now() - 5 * 60_000 - 1_000);

      try {
        await redis.connect();
        await lanes.allocate(
          accountId,
          workerId,
          entityKey,
          firstOperation,
          issuedAt,
          firstCommand,
          'epoch-1',
          createHash('sha256').update('compact-payload-0').digest('hex'),
          'direct_send'
        );
        const firstDigest = createHash('sha256')
          .update(firstOperation)
          .digest('hex');
        await lanes.allocate(
          accountId,
          workerId,
          entityKey,
          secondOperation,
          new Date(issuedAt.getTime() + 1),
          secondCommand,
          'epoch-1',
          createHash('sha256').update('compact-payload-1').digest('hex'),
          'direct_send'
        );

        const secondDigest = createHash('sha256')
          .update(secondOperation)
          .digest('hex');
        await expect(
          redis.hget(laneKey, `op:${secondDigest}:predecessor_satisfied`)
        ).resolves.toBeNull();

        await lanes.markActive(
          accountId,
          workerId,
          entityKey,
          firstOperation,
          firstCommand
        );
        await lanes.markTerminal(
          accountId,
          workerId,
          entityKey,
          firstOperation,
          firstCommand,
          'succeeded'
        );
        await redis.zadd(`${laneKey}:ops`, issuedAt.getTime(), firstDigest);

        await lanes.allocate(
          accountId,
          workerId,
          entityKey,
          thirdOperation,
          new Date(issuedAt.getTime() + 2),
          thirdCommand,
          'epoch-1',
          createHash('sha256').update('compact-payload-2').digest('hex'),
          'direct_send'
        );
        await expect(
          redis.hget(laneKey, `op:${firstDigest}:operation_id`)
        ).resolves.toBeNull();
        await expect(
          lanes.assertPredecessorTerminal(
            accountId,
            workerId,
            entityKey,
            secondOperation,
            firstOperation
          )
        ).resolves.toBeUndefined();
      } finally {
        await redis.del(laneKey, `${laneKey}:ops`).catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    },
    20_000
  );

  integrationTest(
    'keeps N+2 blocked while overdue N+1 depends on ever-active N, then advances in order',
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
      const lanes = new WorkerCommandLaneService(redis);
      const scope = randomUUID();
      const accountId = `lane-account-${scope}`;
      const workerId = `lane-worker-${scope}`;
      const entityKey = `chat:${scope}`;
      const operations = [0, 1, 2].map(
        (index) => `lane-operation-${index}-${scope}`
      );
      const commands = [0, 1, 2].map(
        (index) => `lane-command-${index}-${scope}`
      );
      const [firstOperation, secondOperation, thirdOperation] = operations;
      const [firstCommand, secondCommand, thirdCommand] = commands;
      if (
        !firstOperation ||
        !secondOperation ||
        !thirdOperation ||
        !firstCommand ||
        !secondCommand ||
        !thirdCommand
      ) {
        throw new Error('worker_command_lane_test_identity_missing');
      }
      const issuedAt = new Date(Date.now() - 5 * 60_000 - 1_000);
      const laneKey = lanes.buildLaneKey(accountId, workerId, entityKey);

      try {
        await redis.connect();
        const identities = [
          [firstOperation, firstCommand],
          [secondOperation, secondCommand],
          [thirdOperation, thirdCommand],
        ] as const;
        for (const [index, [operationId, commandId]] of identities.entries()) {
          await lanes.allocate(
            accountId,
            workerId,
            entityKey,
            operationId,
            new Date(issuedAt.getTime() + index),
            commandId,
            'epoch-1',
            createHash('sha256').update(`payload-${index}`).digest('hex'),
            'direct_send'
          );
        }

        await expect(
          lanes.markActive(
            accountId,
            workerId,
            entityKey,
            firstOperation,
            firstCommand
          )
        ).resolves.toBe('acquired');
        await expect(
          lanes.expireNeverActive(
            accountId,
            workerId,
            entityKey,
            secondOperation
          )
        ).resolves.toBe('predecessor_pending');
        await expect(
          lanes.assertPredecessorTerminal(
            accountId,
            workerId,
            entityKey,
            thirdOperation,
            secondOperation
          )
        ).rejects.toMatchObject({
          reason: 'predecessor_dependency_pending',
          predecessorEverActive: false,
          predecessorNeverActive: true,
        });

        const secondDigest = createHash('sha256')
          .update(secondOperation)
          .digest('hex');
        await expect(
          redis.hget(laneKey, `op:${secondDigest}:terminal`)
        ).resolves.toBeNull();

        // Reproduce the legacy race explicitly: even a stale expired marker
        // cannot satisfy N+2 while N remains nonterminal/provider-active.
        await redis.hset(
          laneKey,
          `op:${secondDigest}:terminal`,
          'expired',
          `op:${secondDigest}:terminal_at_ms`,
          String(Date.now())
        );
        await expect(
          lanes.assertPredecessorTerminal(
            accountId,
            workerId,
            entityKey,
            thirdOperation,
            secondOperation
          )
        ).rejects.toMatchObject({
          reason: 'predecessor_dependency_pending',
        });
        await redis.hdel(
          laneKey,
          `op:${secondDigest}:terminal`,
          `op:${secondDigest}:terminal_at_ms`
        );

        await lanes.markTerminal(
          accountId,
          workerId,
          entityKey,
          firstOperation,
          firstCommand,
          'succeeded'
        );
        await expect(
          lanes.expireNeverActive(
            accountId,
            workerId,
            entityKey,
            secondOperation
          )
        ).resolves.toBe('expired');
        await expect(
          lanes.assertPredecessorTerminal(
            accountId,
            workerId,
            entityKey,
            thirdOperation,
            secondOperation
          )
        ).resolves.toBeUndefined();
        await expect(
          lanes.markActive(
            accountId,
            workerId,
            entityKey,
            thirdOperation,
            thirdCommand
          )
        ).resolves.toBe('acquired');
      } finally {
        await redis.del(laneKey, `${laneKey}:ops`).catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    },
    20_000
  );

  integrationTest(
    'atomically terminalizes ever-active as ambiguous without overwriting a concurrent terminal winner',
    async () => {
      if (!redisUrl) throw new Error('TEST_REDIS_URL is required');
      const redis = new Redis(redisUrl, {
        lazyConnect: true,
        connectTimeout: 5_000,
        commandTimeout: 5_000,
        maxRetriesPerRequest: 1,
      });
      const lanes = new WorkerCommandLaneService(redis);
      const scope = randomUUID();
      const accountId = `lane-cap-account-${scope}`;
      const workerId = `lane-cap-worker-${scope}`;
      const entityKey = `chat:${scope}`;
      const laneKey = lanes.buildLaneKey(accountId, workerId, entityKey);
      const firstOperation = `lane-cap-operation-1-${scope}`;
      const firstCommand = `lane-cap-command-1-${scope}`;
      const secondOperation = `lane-cap-operation-2-${scope}`;
      const secondCommand = `lane-cap-command-2-${scope}`;

      try {
        await redis.connect();
        for (const [index, operationId, commandId] of [
          [0, firstOperation, firstCommand],
          [1, secondOperation, secondCommand],
        ] as const) {
          await lanes.allocate(
            accountId,
            workerId,
            entityKey,
            operationId,
            new Date(Date.now() + index),
            commandId,
            'epoch-1',
            createHash('sha256').update(`cap-payload-${index}`).digest('hex'),
            'direct_send'
          );
        }
        await lanes.markActive(
          accountId,
          workerId,
          entityKey,
          firstOperation,
          firstCommand
        );
        await expect(
          lanes.finalizeEverActiveAmbiguous(
            accountId,
            workerId,
            entityKey,
            firstOperation,
            firstCommand
          )
        ).resolves.toBe('terminal:ambiguous');
        await expect(
          lanes.markTerminal(
            accountId,
            workerId,
            entityKey,
            firstOperation,
            firstCommand,
            'succeeded'
          )
        ).rejects.toThrow('worker_command_lane_terminal_immutable_conflict');

        await lanes.assertPredecessorTerminal(
          accountId,
          workerId,
          entityKey,
          secondOperation,
          firstOperation
        );
        await lanes.markActive(
          accountId,
          workerId,
          entityKey,
          secondOperation,
          secondCommand
        );
        await lanes.markTerminal(
          accountId,
          workerId,
          entityKey,
          secondOperation,
          secondCommand,
          'succeeded'
        );
        await expect(
          lanes.finalizeEverActiveAmbiguous(
            accountId,
            workerId,
            entityKey,
            secondOperation,
            secondCommand
          )
        ).resolves.toBe('terminal:succeeded');
      } finally {
        await redis.del(laneKey, `${laneKey}:ops`).catch(() => undefined);
        await redis.quit().catch(() => redis.disconnect());
      }
    },
    20_000
  );
});
