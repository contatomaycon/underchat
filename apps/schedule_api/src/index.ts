import 'reflect-metadata';
import fastify from 'fastify';
import telemetryPlugin from '@core/plugins/telemetry';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import centrifugoPlugin from '@core/plugins/centrifugo';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import redisPlugin from '@core/plugins/redis';
import s3Plugin from '@core/plugins/s3';
import schedulePlugin from '@core/plugins/schedule';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';
import { setupGracefulShutdown } from '@core/plugins/telemetry/errorHandlers';
import startJobs from '@core/jobs';

const server = fastify({
  pluginTimeout: 600000,
  connectionTimeout: 600000,
  keepAliveTimeout: 600000,
  genReqId: () => v7(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.schedule);

server.register(safePlugin(telemetryPlugin, 'telemetry'));
server.register(safePlugin(centrifugoPlugin, 'centrifugo'), {
  module: ERouteModule.schedule,
});
server.register(safePlugin(dbConnector, 'database'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(s3Plugin, 's3'));
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
server.register(safePlugin(schedulePlugin, 'schedule'));

const start = async () => {
  try {
    await server.listen({ port: 3006, host: '0.0.0.0' });

    console.log('Server running');

    setupGracefulShutdown(server);

    startJobs(server, { enableWarmPoolJobs: true });
  } catch (err) {
    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
