import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import 'reflect-metadata';
import fastify from 'fastify';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import centrifugoPlugin from '@core/plugins/centrifugo';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';
import redisPlugin from '@core/plugins/redis';
import s3Plugin from '@core/plugins/s3';
import workerConnectionGrpcServerPlugin from '@core/plugins/proto/workerConnectionGrpcServer';
import wwebjsConsumersOnListenHook, { activateWwebjsRuntime } from './consumer';
import { hasUnhealthyKafkaConsumer } from './consumer/registry';

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  routerOptions: {
    maxParamLength: 2048,
  },
  genReqId: () => v7(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_wwebjs);
server.decorate('wwebjsInitialized', Promise.resolve());
server.decorate('qrStreamReady', false);

server.register(safePlugin(corsPlugin, 'cors'));
server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.worker_wwebjs,
});
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(s3Plugin, 's3'));
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.worker_wwebjs,
});
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.worker_wwebjs,
});
server.register(
  safePlugin(workerConnectionGrpcServerPlugin, 'workerConnectionGrpcServer'),
  {
    module: ERouteModule.worker_wwebjs,
    activateRuntime: activateWwebjsRuntime,
    getKafkaUnhealthy: hasUnhealthyKafkaConsumer,
  }
);

server.register(
  safePlugin(wwebjsConsumersOnListenHook, 'wwebjsConsumersOnListen')
);

const start = async () => {
  try {
    await server.listen({ port: 3005, host: '0.0.0.0' });

    console.log('Server running');
  } catch {
    process.exit(1);
  }
};

start();
