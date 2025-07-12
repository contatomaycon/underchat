import { FastifyInstance } from 'fastify';
import { cacheEnvironment } from '@core/config/environments';
import fp from 'fastify-plugin';
import FastifyRedis from '@fastify/redis';
import FastifyCaching from '@fastify/caching';
import { IConfigRedis } from '@core/common/interfaces/IConfigRedis';

async function cacheRedisConnection(fastify: FastifyInstance) {
  let config: IConfigRedis = {
    host: cacheEnvironment.cacheHost,
    port: cacheEnvironment.cachePort,
    connectTimeout: 10000,
    lazyConnect: true,
    keepAlive: 1000,
  };

  if (cacheEnvironment.cachePassword) {
    config.password = cacheEnvironment.cachePassword;
  }

  try {
    await fastify.register(FastifyRedis, config);

    await fastify.register(FastifyCaching, {
      expiresIn: 300,
    });
  } catch (error) {
    console.log(error);

    fastify.logger.error(error);
  }
}

export default fp(cacheRedisConnection);
