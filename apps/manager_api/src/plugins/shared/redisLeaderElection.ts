import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

type LeaderElectionOptions = {
  redis: Redis;
  logger: FastifyBaseLogger;
  lockKey: string;
  lockTtlSeconds?: number;
  refreshIntervalMs?: number;
  instanceId?: string;
  onLeaderAcquire: () => Promise<void> | void;
  onLeaderLose: () => Promise<void> | void;
};

type LeaderElectionControl = {
  start: () => void;
  stop: () => Promise<void>;
};

export function createRedisLeaderElection(
  options: LeaderElectionOptions
): LeaderElectionControl {
  const {
    redis,
    logger,
    lockKey,
    lockTtlSeconds = 30,
    refreshIntervalMs = 10_000,
    instanceId = process.env.HOSTNAME ?? randomUUID(),
    onLeaderAcquire,
    onLeaderLose,
  } = options;

  let isLeader = false;
  let isRunning = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loopPromise: Promise<void> | null = null;

  const runLeadershipLoop = async (): Promise<void> => {
    if (!isRunning || loopPromise) {
      return;
    }

    loopPromise = (async () => {
      try {
        if (isLeader) {
          const currentOwner = await redis.get(lockKey);

          if (currentOwner === instanceId) {
            await redis.expire(lockKey, lockTtlSeconds);
            return;
          }

          isLeader = false;
          logger.info(
            { lockKey, instanceId },
            'Redis leader lock lost, stopping local worker'
          );
          await onLeaderLose();
          return;
        }

        const acquired = await redis.set(
          lockKey,
          instanceId,
          'EX',
          lockTtlSeconds,
          'NX'
        );

        if (acquired === 'OK') {
          isLeader = true;
          logger.info(
            { lockKey, instanceId },
            'Redis leader lock acquired, starting local worker'
          );
          await onLeaderAcquire();
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            lockKey,
            instanceId,
          },
          'Redis leader election loop failed'
        );
      } finally {
        loopPromise = null;
      }
    })();

    await loopPromise;
  };

  return {
    start: () => {
      if (isRunning) {
        return;
      }

      isRunning = true;

      void runLeadershipLoop();
      timer = setInterval(() => {
        void runLeadershipLoop();
      }, refreshIntervalMs);
    },
    stop: async () => {
      if (!isRunning) {
        return;
      }

      isRunning = false;

      if (timer) {
        clearInterval(timer);
        timer = null;
      }

      if (loopPromise) {
        await loopPromise.catch(() => {});
      }

      if (isLeader) {
        isLeader = false;
        await onLeaderLose();
      }

      try {
        const currentOwner = await redis.get(lockKey);
        if (currentOwner === instanceId) {
          await redis.del(lockKey);
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            lockKey,
            instanceId,
          },
          'Failed to release Redis leader lock'
        );
      }
    },
  };
}
