import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import consumerPlugin from './consumer';
import centrifugoPlugin from '@/plugins/centrifugo';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import kafkaStreamsPlugin from '@core/plugins/kafkaStreams';

const server = fastify({
  genReqId: () => v4(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.worker_baileys);

server.register(corsPlugin);
server.register(swaggerPlugin);

server.register(databaseElasticPlugin, {
  prefix: ERouteModule.service,
});

server.register(kafkaStreamsPlugin, { module: ERouteModule.worker_baileys });
server.register(centrifugoPlugin);
server.register(consumerPlugin);

const start = async () => {
  try {
    await server.listen({ port: 3005, host: '0.0.0.0' });
  } catch (error) {
    console.error('Error:', error);

    process.exit(1);
  }
};

start();
