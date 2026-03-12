import { cacheEnvironment } from '@core/config/environments';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { container } from 'tsyringe';

export const CONNECTION_CLOSED_ERROR_MSG = 'Connection is closed.';

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
    lazyConnect: true,
    keepAlive: 1000,
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

    import('@core/plugins/telemetry/observability.js')
      .then(({ recordException }) => {
        recordException(error, {
          redis: {
            type: 'client_error',
          },
        });
      })
      .catch(() => {});
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

  container.register<Redis>('Redis', {
    useValue: client,
  });

  fastify.decorate<Redis>('Redis', client);

  fastify.addHook('onClose', async () => {
    isShuttingDown = true;
    try {
      await client.quit();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === CONNECTION_CLOSED_ERROR_MSG
      ) {
        fastify.log.debug('Redis already closed during shutdown');
      } else {
        fastify.log.warn({ err: error }, 'Error closing Redis connection');
      }
    }
  });
};

export default fp(redisPlugin, { name: 'redis-plugin' });
