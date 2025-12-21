import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import centrifugoPlugin from '@core/plugins/centrifugo';
import redisPlugin from '@core/plugins/redis';
import consumerPlugin from './consumer';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';

const server = fastify({
  pluginTimeout: 120000,
  genReqId: () => v7(),
  logger: true,
});

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

server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));
server.register(safePlugin(consumerPlugin, 'consumer'));

const start = async () => {
  try {
    await server.listen({ port: 3003, host: '0.0.0.0' });

    console.log('Server running');
  } catch (err) {
    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
