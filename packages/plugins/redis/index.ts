import { cacheEnvironment } from '@core/config/environments';
import {
  PLAN_ENTITLEMENT_REDIS_COMMAND_TIMEOUT_MS,
  PLAN_ENTITLEMENT_REDIS_MAX_RETRIES_PER_REQUEST,
  PLAN_ENTITLEMENT_REDIS_TOKEN,
} from '@core/common/constants/planEntitlement';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { container } from 'tsyringe';
import { criticalRedisOperationTimeoutMs } from '@core/common/functions/criticalRedisOperation';

export const CONNECTION_CLOSED_ERROR_MSG = 'Connection is closed.';
export const SHARED_REDIS_MAX_RETRIES_PER_REQUEST = 1;

export function isRedisConnectionClosed(redis: Redis): boolean {
  return redis.status === 'end' || redis.status === 'close';
}

export async function safeRedisGet(
  redis: Redis,
  key: string
): Promise<string | null> {
  if (isRedisConnectionClosed(redis)) {
    return null;
  }

  try {
    return await redis.get(key);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === CONNECTION_CLOSED_ERROR_MSG
    ) {
      return null;
    }
    throw error;
  }
}

export async function safeRedisSet(
  redis: Redis,
  key: string,
  value: string,
  expiryMode?: 'EX' | 'PX',
  time?: number,
  setMode?: 'NX' | 'XX'
): Promise<string | null> {
  if (isRedisConnectionClosed(redis)) {
    return null;
  }
  try {
    const args: (string | number)[] = [key, value];
    if (expiryMode && time !== undefined) {
      args.push(expiryMode, time);
    }
    if (setMode) {
      args.push(setMode);
    }
    return await (
      redis.set as unknown as (
        ...a: (string | number)[]
      ) => Promise<string | null>
    )(...args);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === CONNECTION_CLOSED_ERROR_MSG
    ) {
      return null;
    }
    throw error;
  }
}

const redisPlugin = async (fastify: FastifyInstance) => {
  const startTs = Date.now();
  fastify.log.info(
    {
      ts: startTs,
      host: cacheEnvironment.cacheHost,
      port: cacheEnvironment.cachePort,
    },
    'Redis plugin inicializando'
  );
  let isShuttingDown = false;

  const client = new Redis({
    host: cacheEnvironment.cacheHost,
    port: cacheEnvironment.cachePort,
    password: cacheEnvironment.cachePassword,
    connectTimeout: 10000,
    commandTimeout: criticalRedisOperationTimeoutMs(),
    maxRetriesPerRequest: SHARED_REDIS_MAX_RETRIES_PER_REQUEST,
    lazyConnect: true,
    keepAlive: 1000,
  });

  // Every shared command is bounded so a frozen socket cannot hold a Kafka
  // partition indefinitely. Entitlement checks retain their shorter,
  // independently tuned fallback budget.
  const planEntitlementClient = client.duplicate({
    commandTimeout: PLAN_ENTITLEMENT_REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: PLAN_ENTITLEMENT_REDIS_MAX_RETRIES_PER_REQUEST,
    lazyConnect: true,
  });

  client.on('error', (error: Error) => {
    if (isShuttingDown && error.message === CONNECTION_CLOSED_ERROR_MSG) {
      fastify.log.debug(
        { type: 'redis_shutdown_error' },
        'Redis connection closed error during shutdown (expected)'
      );
      return;
    }

    fastify.log.error(
      {
        err: error,
        type: 'redis_error',
      },
      'Redis client error'
    );
  });

  client.on('connect', () => {
    fastify.log.info(
      { ms: Date.now() - startTs, ts: Date.now() },
      'Redis client connected'
    );
  });

  client.on('ready', () => {
    fastify.log.info(
      { ms: Date.now() - startTs, ts: Date.now() },
      'Redis client ready'
    );
  });

  client.on('close', () => {
    fastify.log.warn('Redis client connection closed');
  });

  client.on('reconnecting', (delay: number) => {
    fastify.log.warn(
      {
        delay,
      },
      'Redis client reconnecting'
    );
  });

  planEntitlementClient.on('error', (error: Error) => {
    if (isShuttingDown && error.message === CONNECTION_CLOSED_ERROR_MSG) {
      return;
    }

    fastify.log.warn(
      {
        err: error,
        type: 'plan_entitlement_redis_error',
      },
      'Plan entitlement Redis client error; PostgreSQL fallback remains available'
    );
  });

  // Lazy construction keeps application startup independent from Redis, while
  // a background connect prevents `wait` status from persisting until the
  // first request. Entitlement reads still fall back to PostgreSQL unless the
  // client has reached `ready`.
  void client.connect().catch((error: unknown) => {
    fastify.log.warn(
      { err: error, type: 'redis_background_connect_failed' },
      'Redis background connection failed; reconnect will continue'
    );
  });

  void planEntitlementClient.connect().catch((error: unknown) => {
    fastify.log.warn(
      { err: error, type: 'plan_entitlement_redis_background_connect_failed' },
      'Plan entitlement Redis connection failed; PostgreSQL fallback remains available'
    );
  });

  container.register<Redis>('Redis', {
    useValue: client,
  });
  container.register<Redis>(PLAN_ENTITLEMENT_REDIS_TOKEN, {
    useValue: planEntitlementClient,
  });

  fastify.decorate<Redis>('Redis', client);

  fastify.addHook('onClose', async () => {
    isShuttingDown = true;
    for (const [redis, clientType] of [
      [client, 'shared'],
      [planEntitlementClient, 'plan_entitlement'],
    ] as const) {
      try {
        await redis.quit();
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === CONNECTION_CLOSED_ERROR_MSG
        ) {
          fastify.log.debug(
            { client_type: clientType },
            'Redis already closed during shutdown'
          );
        } else {
          fastify.log.warn(
            { err: error, client_type: clientType },
            'Error closing Redis connection'
          );
        }
      }
    }
  });
};

export default fp(redisPlugin, { name: 'redis-plugin' });
