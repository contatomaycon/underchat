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
import baileysConsumersOnListenHook from './consumer';

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  genReqId: () => v7(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_baileys);
server.decorate('baileysInitialized', Promise.resolve());

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
server.register(safePlugin(s3Plugin, 's3'));
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.worker_baileys,
});
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.worker_baileys,
});
server.register(
  safePlugin(workerConnectionGrpcServerPlugin, 'workerConnectionGrpcServer')
);

server.register(
  safePlugin(baileysConsumersOnListenHook, 'baileysConsumersOnListen')
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

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  try {
    server.log.info(
      { signal },
      'Iniciando shutdown gracioso do worker_baileys'
    );
    await server.close();
    process.exit(0);
  } catch (err) {
    server.log.error(
      { err, signal },
      'Erro durante shutdown gracioso do worker_baileys'
    );
    process.exit(1);
  }
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
