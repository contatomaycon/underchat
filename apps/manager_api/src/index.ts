import '@core/plugins/telemetry/instrumentation';
import 'reflect-metadata';
import fastify from 'fastify';
import telemetryPlugin from '@core/plugins/telemetry';
import dbConnector from '@core/config/database';
import authenticateJwt from '@core/middlewares/jwt.middleware';
import authenticateRegisterJwt from '@core/middlewares/registerJwt.middleware';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import jwtPlugin from '@core/plugins/jwt';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import centrifugoPlugin from '@core/plugins/centrifugo';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import redisPlugin from '@core/plugins/redis';
import s3Plugin from '@core/plugins/s3';
import pushDeliveryPlugin from '@core/plugins/pushDelivery';
import presenceMonitorPlugin from '@/plugins/presenceMonitor';
import presenceCentrifugoPlugin from '@/plugins/presenceCentrifugo';
import multipartFile from '@fastify/multipart';
import { generalEnvironment } from '@core/config/environments';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';
import { setupGracefulShutdown } from '@core/plugins/telemetry/errorHandlers';

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

server.decorateRequest('module', ERouteModule.manager);

server.register(safePlugin(telemetryPlugin, 'telemetry'));
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.balancer,
});
server.register(safePlugin(dbConnector, 'database'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(s3Plugin, 's3'));
server.register(safePlugin(pushDeliveryPlugin, 'pushDelivery'));
server.register(safePlugin(presenceMonitorPlugin, 'presenceMonitor'));
server.register(safePlugin(presenceCentrifugoPlugin, 'presenceCentrifugo'));
server.register(safePlugin(authenticateJwt, 'authenticateJwt'));
server.register(safePlugin(authenticateRegisterJwt, 'authenticateRegisterJwt'));
server.register(safePlugin(i18nextPlugin, 'i18next'));
server.register(safePlugin(jwtPlugin, 'jwt'));
server.register(safePlugin(corsPlugin, 'cors'));
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.balancer,
});

server.register(safePlugin(multipartFile, 'multipartFile'), {
  attachFieldsToBody: true,
  limits: { fileSize: generalEnvironment.uploadLimitInBytes },
});

server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.balancer,
});

server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));

const start = async () => {
  try {
    await server.listen({ port: 3002, host: '0.0.0.0' });

    console.log('Server running');

    setupGracefulShutdown(server);
  } catch (err) {
    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
