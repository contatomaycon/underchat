import { captureException, captureMessage } from './sentry';
import { logger } from './logger';

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

  process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received');
    captureMessage('SIGTERM signal received', 'info');
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT signal received');
    captureMessage('SIGINT signal received', 'info');
  });
}
