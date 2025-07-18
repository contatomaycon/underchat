import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import i18nextPlugin from '@core/plugins/i18next';
import { requestHook, responseHook, errorHook } from '@core/hooks';
import cacheRedisConnector from '@core/config/cache';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import elasticLogsPlugin from '@core/plugins/elasticLogs';
import loggerServicePlugin from '@core/plugins/logger';
import kafkaPlugin from '@/plugins/kafka';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import consumerPlugin from './consumer';
import vaultPlugin from '@core/plugins/vault';

const server = fastify({
  genReqId: () => v4(),
  logger: true,
});

server.addHook('preValidation', requestHook);
server.addHook('onSend', responseHook);
server.addHook('onError', errorHook);

server.decorateRequest('module', ERouteModule.service);

server.register(vaultPlugin).after(() => {
  server.register(dbConnector);
  server.register(cacheRedisConnector);
  server.register(authenticateKeyApi);
  server.register(i18nextPlugin);
  server.register(swaggerPlugin);
  server.register(corsPlugin);

  server.register(databaseElasticPlugin, {
    prefix: ERouteModule.service,
  });

  server.register(elasticLogsPlugin, {
    prefix: ERouteModule.service,
  });

  server.register(loggerServicePlugin);
  server.register(kafkaPlugin);
  server.register(consumerPlugin);
});

const start = async () => {
  try {
    await server.listen({ port: 3004, host: '0.0.0.0' });

    server.logger.info('Server running');
  } catch (err) {
    console.log(err);

    server.logger.error(err);
    process.exit(1);
  }
};

start();
