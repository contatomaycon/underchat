import 'reflect-metadata';
import 'module-alias/register';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
console.log('[worker_baileys:init] index.ts: imports iniciados', {
  ts: Date.now(),
});
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
console.log('[worker_baileys:init] index.ts: todos imports carregados', {
  ts: Date.now(),
});

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  genReqId: () => v7(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_baileys);
console.log('[worker_baileys:init] index.ts: decorateRequest concluído', {
  ts: Date.now(),
});

let tPlugin = Date.now();
server.register(safePlugin(corsPlugin, 'cors'));
console.log('[worker_baileys:init] index.ts: após register cors', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(swaggerPlugin, 'swagger'));
console.log('[worker_baileys:init] index.ts: após register swagger', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
console.log('[worker_baileys:init] index.ts: após register routes', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(fastifyQs, 'fastifyQs'));
console.log('[worker_baileys:init] index.ts: após register fastifyQs', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.worker_baileys,
});
console.log('[worker_baileys:init] index.ts: após register databaseElastic', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(redisPlugin, 'redis'));
console.log('[worker_baileys:init] index.ts: após register redis', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.worker_baileys,
});
console.log('[worker_baileys:init] index.ts: após register kafkaStreams', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});
tPlugin = Date.now();
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.worker_baileys,
});
console.log('[worker_baileys:init] index.ts: após register centrifugo', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});

registerConsumersCloseHook(server);
console.log(
  '[worker_baileys:init] index.ts: registerConsumersCloseHook concluído',
  { ts: Date.now() }
);
tPlugin = Date.now();
server.register(safePlugin(baileysReadyHook, 'baileysReady'));
console.log('[worker_baileys:init] index.ts: após register baileysReadyHook', {
  ts: Date.now(),
  ms: Date.now() - tPlugin,
});

const start = async () => {
  try {
    const tListen = Date.now();
    console.log('[worker_baileys:init] index.ts: iniciando server.listen', {
      ts: Date.now(),
    });
    await server.listen({ port: 3005, host: '0.0.0.0' });
    console.log('[worker_baileys:init] index.ts: server.listen concluído', {
      ts: Date.now(),
      ms: Date.now() - tListen,
    });

    console.log('[worker_baileys:init] Server running');

    const tConsumers = Date.now();
    console.log('[worker_baileys:init] index.ts: iniciando startConsumers', {
      ts: Date.now(),
    });
    startConsumers(server);
    console.log(
      '[worker_baileys:init] index.ts: startConsumers chamado (assíncrono)',
      { ts: Date.now(), ms: Date.now() - tConsumers }
    );
  } catch (error) {
    console.error('[worker_baileys:init] Error:', error);

    process.exit(1);
  }
};

console.log('[worker_baileys:init] index.ts: chamando start()', {
  ts: Date.now(),
});
start();
