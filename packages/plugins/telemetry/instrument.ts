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
      const isConnectionTerminatedError = (error: Error): boolean => {
        const message = error.message.toLowerCase();
        return (
          message.includes('connection terminated') ||
          message.includes('connection closed') ||
          message.includes('connection ended') ||
          message.includes('server closed the connection') ||
          message.includes('terminating connection due to') ||
          message.includes('terminated unexpectedly')
        );
      };

      if (event.exception) {
        const error = hint.originalException;
        if (error instanceof Error) {
          if (
            (error.message.includes('ECONNREFUSED') &&
              environment === 'development') ||
            isConnectionTerminatedError(error)
          ) {
            return null;
          }
        }
      }

      const contexts = event.contexts || {};
      if (
        contexts.database &&
        (contexts.database as { type?: string }).type === 'pool_error'
      ) {
        const error = hint.originalException;
        if (error instanceof Error && isConnectionTerminatedError(error)) {
          return null;
        }
      }

      if (
        event.message &&
        typeof event.message === 'object' &&
        'formatted' in event.message &&
        typeof (event.message as { formatted?: string }).formatted ===
          'string' &&
        (event.message as { formatted: string }).formatted
          .toLowerCase()
          .includes('sigterm signal received') &&
        event.level === 'info'
      ) {
        return null;
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
