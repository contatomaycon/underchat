import type { FastifyBaseLogger } from 'fastify';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

export type RedisLeaderElectionRole =
  'idle' | 'electing' | 'leader' | 'standby' | 'stopped';

export interface RedisLeaderElectionSnapshot {
  role: RedisLeaderElectionRole;
  running: boolean;
  leader: boolean;
  healthy: boolean;
  last_checked_at: string | null;
  last_error_at: string | null;
}

type LeaderElectionOptions = {
  redis: Redis;
  logger: FastifyBaseLogger;
  lockKey: string;
  lockTtlSeconds?: number;
  refreshIntervalMs?: number;
  instanceId?: string;
  onLeaderAcquire: () => Promise<void> | void;
  onLeaderLose: () => Promise<void> | void;
  onStateChange?: (snapshot: RedisLeaderElectionSnapshot) => void;
};

export type LeaderElectionControl = {
  start: () => void;
  stop: () => Promise<void>;
  getStatus: () => RedisLeaderElectionSnapshot;
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
    onStateChange,
  } = options;

  let isLeader = false;
  let isRunning = false;
  let role: RedisLeaderElectionRole = 'idle';
  let healthy = true;
  let lastCheckedAt: string | null = null;
  let lastErrorAt: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let loopPromise: Promise<void> | null = null;

  const getStatus = (): RedisLeaderElectionSnapshot => ({
    role,
    running: isRunning,
    leader: isLeader,
    healthy,
    last_checked_at: lastCheckedAt,
    last_error_at: lastErrorAt,
  });

  const notifyStateChange = (): void => {
    try {
      onStateChange?.(getStatus());
    } catch (error) {
      logger.warn(
        { err: error, lockKey, instanceId },
        'Redis leader election state observer failed'
      );
    }
  };

  const runLeadershipLoop = async (): Promise<void> => {
    if (!isRunning || loopPromise || redis.status !== 'ready') {
      return;
    }

    loopPromise = (async () => {
      try {
        if (isLeader) {
          const currentOwner = await redis.get(lockKey);

          if (currentOwner === instanceId) {
            await redis.expire(lockKey, lockTtlSeconds);
            healthy = true;
            role = 'leader';
            lastCheckedAt = new Date().toISOString();
            notifyStateChange();
            return;
          }

          isLeader = false;
          healthy = true;
          role = 'standby';
          lastCheckedAt = new Date().toISOString();
          notifyStateChange();
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
          healthy = true;
          role = 'leader';
          lastCheckedAt = new Date().toISOString();
          notifyStateChange();
          logger.info(
            { lockKey, instanceId },
            'Redis leader lock acquired, starting local worker'
          );
          await onLeaderAcquire();
          return;
        }

        healthy = true;
        role = 'standby';
        lastCheckedAt = new Date().toISOString();
        notifyStateChange();
      } catch (error) {
        healthy = false;
        lastErrorAt = new Date().toISOString();
        notifyStateChange();
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

  const onRedisReady = (): void => {
    void runLeadershipLoop();
  };

  return {
    start: () => {
      if (isRunning) {
        return;
      }

      isRunning = true;
      healthy = true;
      role = 'electing';
      notifyStateChange();

      redis.on('ready', onRedisReady);
      onRedisReady();
      timer = setInterval(() => {
        void runLeadershipLoop();
      }, refreshIntervalMs);
    },
    stop: async () => {
      if (!isRunning) {
        return;
      }

      isRunning = false;
      redis.off('ready', onRedisReady);

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

      role = 'stopped';
      healthy = true;
      notifyStateChange();

      if (redis.status !== 'ready') {
        return;
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
    getStatus,
  };
}
