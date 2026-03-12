import { addEvent, recordException, recordMessage } from './observability';
import { logger } from './logger';
import type { FastifyInstance } from 'fastify';

let handlersRegistered = false;

export function setupErrorHandlers(): void {
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  process.on('uncaughtException', (error: Error) => {
    logger.fatal(
      {
        err: error,
        type: 'uncaughtException',
        stack: error.stack,
      },
      'Uncaught exception detected'
    );

    recordException(error, {
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

      recordException(error, {
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

    recordMessage(warning.message, 'warn', {
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
    addEvent({
      message: `${signal} signal received, starting graceful shutdown`,
      category: 'signal',
      level: 'info',
      data: {
        signal,
      },
    });

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      await server.close();
      clearTimeout(forceExit);

      logger.info('Server closed successfully');

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

      recordException(
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

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}
