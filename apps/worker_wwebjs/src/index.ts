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
import workerDatabasePlugin from '@core/plugins/workerDatabase';
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
import planEntitlementTelemetryPlugin from '@core/plugins/planEntitlementTelemetry';
import { balancerRuntimeFenceToken } from '@core/common/functions/balancerRuntimeFenceAuth';
import { installNodeWorkerGracefulShutdown } from '@core/common/functions/nodeWorkerGracefulShutdown';
import { workerErrorDiagnostics } from '@core/common/functions/workerErrorDiagnostics';

// Only legacy WWebJS volumes call Balance, to authorize Chromium lock cleanup.
// PostgreSQL-backed workers have no worker-to-Balance data path or credential.
if (
  (process.env.WORKER_SESSION_STORAGE?.trim() || 'legacy_volume') ===
  'legacy_volume'
) {
  balancerRuntimeFenceToken();
}

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
const nodeWorkerShutdown = installNodeWorkerGracefulShutdown(server, {
  workerName: 'WWebJS',
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
server.register(safePlugin(workerDatabasePlugin, 'workerDatabase'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(
  safePlugin(planEntitlementTelemetryPlugin, 'planEntitlementTelemetry')
);
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

    server.log.info('WWebJS worker server running');
  } catch (err) {
    if (nodeWorkerShutdown.isShuttingDown()) {
      return;
    }
    server.log.fatal(
      workerErrorDiagnostics(err),
      'Unable to start WWebJS worker server'
    );
    process.exit(1);
  }
};

void start();
