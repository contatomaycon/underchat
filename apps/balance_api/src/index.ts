import 'reflect-metadata';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import centrifugoPlugin from '@core/plugins/centrifugo';
import redisPlugin from '@core/plugins/redis';
import workerGrpcServerPlugin from '@core/plugins/proto/workerGrpcServer';
import workerImageReconcilerPlugin from '@core/plugins/workerImageReconciler';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';
import { installBalanceApiGracefulShutdown } from '@core/common/functions/balanceApiGracefulShutdown';

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

const balanceApiShutdown = installBalanceApiGracefulShutdown(server);

server.decorateRequest('module', ERouteModule.balancer);

server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.balancer,
});
server.register(safePlugin(dbConnector, 'database'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(authenticateKeyApi, 'authenticateKeyApi'));
server.register(safePlugin(i18nextPlugin, 'i18next'));
server.register(safePlugin(corsPlugin, 'cors'));

server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.balancer,
});

server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.balancer,
});

server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));
server.register(safePlugin(workerGrpcServerPlugin, 'workerGrpcServer'));
server.register(
  safePlugin(workerImageReconcilerPlugin, 'workerImageReconciler')
);

const start = async () => {
  try {
    await server.listen({ port: 3003, host: '0.0.0.0' });

    console.log('Server running');
  } catch (err) {
    if (balanceApiShutdown.isShuttingDown()) {
      return;
    }

    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
