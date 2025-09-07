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
    fastify.log.error(error);
  });

  container.register<Redis>('Redis', {
    useValue: client,
  });

  fastify.decorate<Redis>('Redis', client);
};

export default fp(redisPlugin, { name: 'redis-plugin' });
