import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import auth from '@fastify/auth';
import authenticateJwt from '@core/middlewares/jwt.middleware';
import i18nextPlugin from '@core/plugins/i18next';
import { requestHook, responseHook, errorHook } from '@core/hooks';
import cacheRedisConnector from '@core/config/cache';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import jwtPlugin from '@core/plugins/jwt';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import elasticLogsPlugin from '@core/plugins/elasticLogs';
import loggerServicePlugin from '@core/plugins/logger';
import kafkaPlugin from '@core/plugins/kafka';

const server = fastify({
  genReqId: () => v4(),
  logger: true,
});

server.addHook('preValidation', requestHook);
server.addHook('onSend', responseHook);
server.addHook('onError', errorHook);

server.decorateRequest('module', ERouteModule.manager);

server.register(dbConnector);
server.register(cacheRedisConnector);
server.register(auth);
server.register(authenticateJwt);
server.register(i18nextPlugin);
server.register(jwtPlugin);
server.register(swaggerPlugin);
server.register(corsPlugin);

server.register(databaseElasticPlugin, {
  prefix: ERouteModule.manager,
});

server.register(elasticLogsPlugin, {
  prefix: ERouteModule.manager,
});

server.register(loggerServicePlugin);
server.register(kafkaPlugin);

const start = async () => {
  try {
    await server.listen({ port: 3002, host: '0.0.0.0' });

    server.logger.info('Server running');
  } catch (err) {
    console.log(err);

    server.logger.error(err);
    process.exit(1);
  }
};

start();
