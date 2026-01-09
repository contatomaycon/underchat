import { cacheEnvironment } from '@core/config/environments';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { container } from 'tsyringe';

const redisPlugin = async (fastify: FastifyInstance) => {
  const client = new Redis({
    host: cacheEnvironment.cacheHost,
    port: cacheEnvironment.cachePort,
    password: cacheEnvironment.cachePassword,
    connectTimeout: 10000,
    lazyConnect: true,
    keepAlive: 1000,
  });

  client.on('error', (error: Error) => {
    fastify.log.error(
      {
        err: error,
        type: 'redis_error',
      },
      'Redis client error'
    );

    import('@core/plugins/telemetry/sentry.js')
      .then(({ captureException }) => {
        captureException(error, {
          redis: {
            type: 'client_error',
          },
        });
      })
      .catch(() => {});
  });

  client.on('connect', () => {
    fastify.log.info('Redis client connected');
  });

  client.on('ready', () => {
    fastify.log.info('Redis client ready');
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
    await client.quit();
  });
};

export default fp(redisPlugin, { name: 'redis-plugin' });
