import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import dbConnector from '@core/config/database';
import authenticateKeyApi from '@core/middlewares/keyapi.middleware';
import i18nextPlugin from '@core/plugins/i18next';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v7 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import jwtPlugin from '@core/plugins/jwt';
import multipartFile from '@fastify/multipart';
import { generalEnvironment } from '@core/config/environments';
import databaseElasticPlugin from '@core/plugins/dbElastic';
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

server.decorateRequest('module', ERouteModule.public);

server.register(safePlugin(multipartFile, 'multipartFile'), {
  attachFieldsToBody: true,
  limits: { fileSize: generalEnvironment.uploadLimitInBytes },
});
server.register(safePlugin(dbConnector, 'database'));
server.register(safePlugin(redisPlugin, 'redis'));
server.register(safePlugin(authenticateKeyApi, 'authenticateKeyApi'));
server.register(safePlugin(i18nextPlugin, 'i18next'));
server.register(safePlugin(jwtPlugin, 'jwt'));
server.register(safePlugin(corsPlugin, 'cors'));
server.register(safePlugin(databaseElasticPlugin, 'databaseElastic'), {
  prefix: ERouteModule.public,
});

server.register(safePlugin(swaggerPlugin, 'swagger'));
server.register(safePlugin(routes, 'routes', true), {
  prefix: EPrefixRoutes.v1,
});
server.register(safePlugin(fastifyQs, 'fastifyQs'));

const start = async () => {
  try {
    await server.listen({ port: 3001, host: '0.0.0.0' });

    console.log('Server running');
  } catch (err) {
    console.log(err);

    console.error(err);
    process.exit(1);
  }
};

start();
