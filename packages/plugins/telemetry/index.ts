import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { incrementCounter, recordHistogram } from './observability';
import { setupErrorHandlers } from './errorHandlers';
import { initializeSdk, shutdownSdk } from './sdk';
import { logger } from './logger';
import { telemetryEnvironment } from '@core/config/environments';
import {
  createRequestLatencyContext,
  enterRequestLatencyContext,
  MANAGER_SLOW_REQUEST_THRESHOLD_MS,
  type RequestLatencyContext,
} from './requestLatency';

async function telemetryPlugin(fastify: FastifyInstance): Promise<void> {
  setupErrorHandlers();
  initializeSdk();

  const requestDurations = new WeakMap<FastifyRequest, number>();
  const requestLatencyContexts = new WeakMap<
    FastifyRequest,
    RequestLatencyContext
  >();

  const snapshotPool = (pool: unknown) => {
    if (
      typeof pool !== 'object' ||
      pool === null ||
      !('totalCount' in pool) ||
      !('idleCount' in pool) ||
      !('waitingCount' in pool)
    ) {
      return null;
    }

    const currentPool = pool as {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
    };

    return {
      totalCount: currentPool.totalCount,
      idleCount: currentPool.idleCount,
      waitingCount: currentPool.waitingCount,
    };
  };

  fastify.addHook('onRequest', async (request) => {
    requestDurations.set(request, Date.now());
    const latencyContext = createRequestLatencyContext();
    requestLatencyContexts.set(request, latencyContext);
    enterRequestLatencyContext(latencyContext);

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

      if (
        telemetryEnvironment.serviceName.includes('manager') &&
        duration >= MANAGER_SLOW_REQUEST_THRESHOLD_MS
      ) {
        const latencyContext = requestLatencyContexts.get(request);

        request.log.warn(
          {
            type: 'manager_slow_request_breakdown',
            service: telemetryEnvironment.serviceName,
            method: request.method,
            route: request.routeOptions.url || request.url,
            statusCode: reply.statusCode,
            duration,
            slow_threshold_ms: MANAGER_SLOW_REQUEST_THRESHOLD_MS,
            stages: latencyContext?.stages ?? [],
            database_pool: {
              rw: snapshotPool(request.server.DatabasePoolRw),
              ro: snapshotPool(request.server.DatabasePoolRo),
            },
          },
          'Manager slow request breakdown'
        );
      }
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
