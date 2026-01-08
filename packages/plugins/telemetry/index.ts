import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as Sentry from '@sentry/node';
import { setupErrorHandlers } from './errorHandlers';
import { logger } from './logger';
import { telemetryEnvironment } from '@core/config/environments';

async function telemetryPlugin(fastify: FastifyInstance): Promise<void> {
  setupErrorHandlers();

  const serviceName = telemetryEnvironment.sentryServiceName;
  const environment = telemetryEnvironment.sentryEnvironment;

  Sentry.setTag('service', serviceName);
  Sentry.setTag('api', serviceName);
  Sentry.setContext('service', {
    name: serviceName,
    environment,
  });

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
          statusCode: reply.statusCode,
          duration,
        },
        'Request completed'
      );
    }

    return payload;
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
