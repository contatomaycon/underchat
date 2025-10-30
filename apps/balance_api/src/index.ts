import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { requestHook, responseHook, errorHook } from '@core/hooks';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import loggerServicePlugin from '@core/plugins/logger';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import elasticLogsPlugin from '@core/plugins/elasticLogs';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import centrifugoPlugin from '@core/plugins/centrifugo';
import consumerPlugin from './consumer';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';

const server = fastify({
  pluginTimeout: 120000,
  genReqId: () => v4(),
  logger: true,
});

server.addHook('preValidation', requestHook);
server.addHook('onSend', responseHook);
server.addHook('onError', errorHook);

server.decorateRequest('module', ERouteModule.balancer);

server.register(safePlugin(centrifugoPlugin, 'centrifugo', false), {
  module: ERouteModule.balancer,
});
server.register(safePlugin(dbConnector, 'database', false));
server.register(safePlugin(authenticateKeyApi, 'authenticateKeyApi', false));
server.register(safePlugin(i18nextPlugin, 'i18next', false));
server.register(safePlugin(corsPlugin, 'cors'));

server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams', false), {
  module: ERouteModule.balancer,
});

server.register(safePlugin(elasticLogsPlugin, 'elasticLogs', false), {
  prefix: ERouteModule.balancer,
});

server.register(safePlugin(loggerServicePlugin, 'loggerService', false));
server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes'), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs', false));
server.register(safePlugin(consumerPlugin, 'consumer', false));

const start = async () => {
  try {
    await server.listen({ port: 3003, host: '0.0.0.0' });

    server.logger.info('Server running');
  } catch (err) {
    console.log(err);

    server.logger.error(err);
    process.exit(1);
  }
};

start();
