import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import authenticateJwt from '@core/middlewares/jwt.middleware';
import i18nextPlugin from '@core/plugins/i18next';
import { requestHook, responseHook, errorHook } from '@core/hooks';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import jwtPlugin from '@core/plugins/jwt';
import multipartFile from '@fastify/multipart';
import { generalEnvironment } from '@core/config/environments';
import databaseElasticPlugin from '@core/plugins/dbElastic';
import elasticLogsPlugin from '@core/plugins/elasticLogs';
import loggerServicePlugin from '@core/plugins/logger';
import redisPlugin from '@core/plugins/redis';
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

server.decorateRequest('module', ERouteModule.public);

server.register(safePlugin(multipartFile, 'multipartFile', false), {
  attachFieldsToBody: true,
  limits: { fileSize: generalEnvironment.uploadLimitInBytes },
});
server.register(safePlugin(dbConnector, 'database', false));
server.register(safePlugin(redisPlugin, 'redis', false));
server.register(safePlugin(authenticateJwt, 'authenticateJwt', false));
server.register(safePlugin(i18nextPlugin, 'i18next', false));
server.register(safePlugin(jwtPlugin, 'jwt', false));
server.register(safePlugin(corsPlugin, 'cors'));
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic', false), {
  prefix: ERouteModule.public,
});

server.register(safePlugin(elasticLogsPlugin, 'elasticLogs', false), {
  prefix: ERouteModule.public,
});

server.register(safePlugin(loggerServicePlugin, 'loggerService', false));
server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes'), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs', false));

const start = async () => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });

    server.logger.info('Server running');
  } catch (err) {
    console.log(err);

    server.logger.error(err);
    process.exit(1);
  }
};

start();
