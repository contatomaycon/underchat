import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import { startConsumers, registerConsumersCloseHook } from './consumer';
import centrifugoPlugin from '@core/plugins/centrifugo';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';
import baileysReadyHook from './hooks/baileysReady.hook';
import redisPlugin from '@core/plugins/redis';

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  genReqId: () => v7(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_baileys);

server.register(safePlugin(corsPlugin, 'cors'));
server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.worker_baileys,
});
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.worker_baileys,
});
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.worker_baileys,
});

registerConsumersCloseHook(server);
server.register(safePlugin(baileysReadyHook, 'baileysReady'));

const start = async () => {
  try {
    await server.listen({ port: 3005, host: '0.0.0.0' });

    console.log('Server running');

    startConsumers(server);
  } catch {
    process.exit(1);
  }
};

start();
