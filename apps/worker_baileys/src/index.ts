import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import consumerPlugin from './consumer';
import centrifugoPlugin from '@core/plugins/centrifugo';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';
import fastifyQs from 'fastify-qs';
import routes from '@/routes';
import { EPrefixRoutes } from '@core/common/enums/EPrefixRoutes';
import { safePlugin } from '@core/common/functions/safePlugin';

const server = fastify({
  pluginTimeout: 120000,
  genReqId: () => v4(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_baileys);

server.register(safePlugin(corsPlugin, 'cors'));

server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes'), { prefix: EPrefixRoutes.v1 });
server.register(safePlugin(fastifyQs, 'fastifyQs', false));

server.register(safePlugin(databaseElasticPlugin, 'databaseElastic', false), {
  prefix: ERouteModule.worker_baileys,
});

server.register(safePlugin(kafkaStreamsPlugin, 'kafkaStreams', false), {
  module: ERouteModule.worker_baileys,
});
server.register(safePlugin(centrifugoPlugin, 'centrifugo', false), {
  module: ERouteModule.worker_baileys,
});
server.register(safePlugin(consumerPlugin, 'consumer', false));

const start = async () => {
  try {
    await server.listen({ port: 3005, host: '0.0.0.0' });
  } catch (error) {
    console.error('Error:', error);

    process.exit(1);
  }
};

start();
