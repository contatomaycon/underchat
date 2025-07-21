import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import auth from '@fastify/auth';
import i18nextPlugin from '@core/plugins/i18next';
import { requestHook, responseHook, errorHook } from '@core/hooks';
import cacheRedisConnector from '@core/config/cache';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import loggerServicePlugin from '@core/plugins/logger';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import elasticLogsPlugin from '@core/plugins/elasticLogs';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import vaultPlugin from '@core/plugins/vault';

const server = fastify({
  genReqId: () => v4(),
  logger: true,
});

server.addHook('preValidation', requestHook);
server.addHook('onSend', responseHook);
server.addHook('onError', errorHook);

server.decorateRequest('module', ERouteModule.balancer);

server.register(vaultPlugin).after(() => {
  server.register(dbConnector);
  server.register(cacheRedisConnector);
  server.register(auth);
  server.register(authenticateKeyApi);
  server.register(i18nextPlugin);
  server.register(corsPlugin);

  server.register(elasticLogsPlugin, {
    prefix: ERouteModule.balancer,
  });

  server.register(loggerServicePlugin);
  server.register(swaggerPlugin);
});

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
