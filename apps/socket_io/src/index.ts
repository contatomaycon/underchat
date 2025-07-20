import 'reflect-metadata';
import 'module-alias/register';
import fastify from 'fastify';
import cacheRedisConnector from '@core/config/cache';
import { ERouteModule } from '@core/common/enums/ERouteModule';
import { v4 } from 'uuid';
import swaggerPlugin from '@/plugins/swagger';
import corsPlugin from '@core/plugins/cors';
import vaultPlugin from '@core/plugins/vault';
import socketioPlugin from '@/plugins/socketio';

const server = fastify({
  genReqId: () => v4(),
  logger: true,
});

server.decorateRequest('module', ERouteModule.socket);

server.register(vaultPlugin).after(() => {
  server.register(cacheRedisConnector);
  server.register(swaggerPlugin);
  server.register(corsPlugin);
  server.register(socketioPlugin);
});

const start = async () => {
  try {
    await server.listen({ port: 3005, host: '0.0.0.0' });
  } catch (err) {
    console.log(err);

    process.exit(1);
  }
};

start();
