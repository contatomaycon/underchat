import * as Sentry from '@sentry/node';
import { fastifyIntegration } from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { telemetryEnvironment } from '@core/config/environments';

if (telemetryEnvironment.enableSentry) {
  const serviceName = telemetryEnvironment.sentryServiceName;
  const environment = telemetryEnvironment.sentryEnvironment;

  Sentry.init({
    dsn: telemetryEnvironment.sentryDsn,
    environment,
    serverName: serviceName,
    initialScope: {
      tags: {
        service: serviceName,
        api: serviceName,
      },
      contexts: {
        service: {
          name: serviceName,
          environment,
        },
      },
    },
    integrations: [
      fastifyIntegration({
        shouldHandleError(_error, _request, reply) {
          return reply.statusCode >= 500;
        },
      }),
      nodeProfilingIntegration(),
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
    enableLogs: true,
    tracesSampleRate: telemetryEnvironment.sentryTracesSampleRate,
    profilesSampleRate: telemetryEnvironment.sentryProfilesSampleRate,
    beforeSend(event, hint) {
      if (event.exception) {
        const error = hint.originalException;
        if (
          error instanceof Error &&
          error.message.includes('ECONNREFUSED') &&
          environment === 'development'
        ) {
          return null;
        }
      }

      if (!event.tags) {
        event.tags = {};
      }
      event.tags.service = serviceName;
      event.tags.api = serviceName;

      return event;
    },
  });
}

export {};
