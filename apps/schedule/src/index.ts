import '@core/plugins/telemetry/instrument';
import 'reflect-metadata';
import 'module-alias/register';
import * as Sentry from '@sentry/node';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import { startTemporalWorkers, startTemporalSchedules } from './temporal';
import centrifugoPlugin from '@core/plugins/centrifugo';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import temporalPlugin from '@core/plugins/temporal';
import redisPlugin from '@core/plugins/redis';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  genReqId: () => v7(),
  logger: true,
});

Sentry.setupFastifyErrorHandler(server);

server.decorateRequest('module', ERouteModule.schedule);

server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.schedule,
});
server.register(safePlugin(dbConnector, 'database'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(i18nextPlugin, 'i18next'));
server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams'), {
  module: ERouteModule.schedule,
});
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.schedule,
});
server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));
server.register(safePlugin(temporalPlugin, 'temporal'));

const start = async () => {
  try {
    await server.listen({ port: 3006, host: '0.0.0.0' });

    console.log('Server running');

    startTemporalWorkers(server);
    startTemporalSchedules(server);
  } catch (err) {
    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
