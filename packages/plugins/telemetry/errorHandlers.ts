import { addBreadcrumb, captureException, captureMessage } from './sentry';
import { logger } from './logger';
import type { FastifyInstance } from 'fastify';

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
  const shutdown = async (signal: string) => {
    logger.info(`${signal} signal received, starting graceful shutdown`);
    addBreadcrumb({
      message: `${signal} signal received, starting graceful shutdown`,
      level: 'info',
      category: 'signal',
      data: { signal },
    });

    try {
      await server.close();
      logger.info('Server closed successfully');
      process.exit(0);
    } catch (error) {
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
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
