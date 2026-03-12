import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { incrementCounter, recordHistogram } from './observability';
import { setupErrorHandlers } from './errorHandlers';
import { initializeSdk, shutdownSdk } from './sdk';
import { logger } from './logger';
import { telemetryEnvironment } from '@core/config/environments';

async function telemetryPlugin(fastify: FastifyInstance): Promise<void> {
  setupErrorHandlers();
  initializeSdk();

  const requestDurations = new WeakMap<FastifyRequest, number>();

  fastify.addHook('onRequest', async (request) => {
    requestDurations.set(request, Date.now());

    request.log = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
  });

  fastify.addHook('onSend', async (request, reply, payload: unknown) => {
    const startTime = requestDurations.get(request);
    if (startTime) {
      const duration = Date.now() - startTime;

      request.log.info(
        {
          service: telemetryEnvironment.serviceName,
          statusCode: reply.statusCode,
          duration,
        },
        'Request completed'
      );

      incrementCounter('http.server.requests.total', 1, {
        service: telemetryEnvironment.serviceName,
        http_method: request.method,
        http_route: request.routeOptions.url || request.url,
        http_status_code: reply.statusCode,
      });

      recordHistogram('http.server.requests.duration.ms', duration, {
        service: telemetryEnvironment.serviceName,
        http_method: request.method,
        http_route: request.routeOptions.url || request.url,
        http_status_code: reply.statusCode,
      });
    }

    return payload;
  });

  fastify.addHook('onClose', async () => {
    await shutdownSdk();
  });

  fastify.decorate('logger', logger);
}

export default fp(telemetryPlugin, {
  name: 'telemetry',
});

declare module 'fastify' {
  interface FastifyInstance {
    logger: typeof logger;
  }
}
