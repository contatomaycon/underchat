import { addBreadcrumb, captureException, captureMessage } from './sentry';
import { logger } from './logger';
import type { FastifyInstance } from 'fastify';
import * as Sentry from '@sentry/node';
import { telemetryEnvironment } from '@core/config/environments';

export function setupErrorHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    logger.fatal(
      {
        err: error,
        type: 'uncaughtException',
        stack: error.stack,
      },
      'Uncaught exception detected'
    );

    captureException(error, {
      uncaughtException: {
        message: error.message,
        stack: error.stack,
      },
    });

    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on(
    'unhandledRejection',
    (reason: unknown, promise: Promise<unknown>) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));

      logger.fatal(
        {
          err: error,
          type: 'unhandledRejection',
          promise: promise.toString(),
          stack: error.stack,
        },
        'Unhandled rejection detected'
      );

      captureException(error, {
        unhandledRejection: {
          message: error.message,
          stack: error.stack,
          promise: promise.toString(),
        },
      });
    }
  );

  process.on('warning', (warning: Error) => {
    logger.warn(
      {
        err: warning,
        type: 'warning',
        stack: warning.stack,
      },
      'Process warning'
    );

    captureMessage(warning.message, 'warning', {
      warning: {
        name: warning.name,
        stack: warning.stack,
      },
    });
  });
}

export function setupGracefulShutdown(server: FastifyInstance): void {
  let isShuttingDown = false;
  const SHUTDOWN_TIMEOUT = 30000;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn(`${signal} signal received during shutdown, ignoring`);
      return;
    }

    isShuttingDown = true;

    logger.info(`${signal} signal received, starting graceful shutdown`);
    addBreadcrumb({
      message: `${signal} signal received, starting graceful shutdown`,
      level: 'info',
      category: 'signal',
      data: { signal },
    });

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      await server.close();
      clearTimeout(forceExit);

      logger.info('Server closed successfully');

      if (telemetryEnvironment.enableSentry) {
        try {
          await Sentry.flush(2000);
        } catch {}
      }

      process.exit(0);
    } catch (error) {
      clearTimeout(forceExit);

      logger.error(
        {
          err: error,
          type: 'graceful_shutdown_error',
        },
        'Error during graceful shutdown'
      );

      captureException(
        error instanceof Error ? error : new Error(String(error)),
        {
          gracefulShutdown: {
            signal,
            type: 'shutdown_error',
          },
        }
      );

      if (telemetryEnvironment.enableSentry) {
        try {
          await Sentry.flush(2000);
        } catch {}
      }

      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
