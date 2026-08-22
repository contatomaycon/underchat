import 'reflect-metadata';
import type { FastifyInstance } from 'fastify';
import { buildWebhookDispatcherApp } from './app';
import { readWebhookDispatcherRuntimeConfig } from './config';

const SHUTDOWN_TIMEOUT_MS = 25_000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeStartupFailure = (error: unknown): void => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      service: 'webhook_dispatcher',
      message: 'Unable to initialize outbound webhook dispatcher',
      error: errorMessage(error),
    })}\n`
  );
};

const start = async (): Promise<void> => {
  let server: FastifyInstance | null = null;

  try {
    const config = readWebhookDispatcherRuntimeConfig();
    server = buildWebhookDispatcherApp(config);
    let closePromise: Promise<void> | null = null;
    let shutdownDeadline: NodeJS.Timeout | null = null;

    const removeProcessListeners = (): void => {
      process.off('SIGTERM', onSigterm);
      process.off('SIGINT', onSigint);
      process.off('uncaughtException', onUncaughtException);
      process.off('unhandledRejection', onUnhandledRejection);
    };

    const close = (
      reason: string,
      exitCode: number,
      error?: unknown
    ): Promise<void> => {
      if (closePromise) return closePromise;
      if (exitCode !== 0) process.exitCode = exitCode;

      const logContext = error
        ? { reason, err: error }
        : { reason, signal: reason };
      if (exitCode === 0) {
        server?.log.info(logContext, 'Draining outbound webhook dispatcher');
      } else {
        server?.log.fatal(
          logContext,
          'Stopping outbound webhook dispatcher after a fatal error'
        );
      }

      shutdownDeadline = setTimeout(() => {
        server?.log.fatal(
          { reason, timeout_ms: SHUTDOWN_TIMEOUT_MS },
          'Webhook dispatcher graceful shutdown deadline exceeded'
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      closePromise = (async (): Promise<void> => {
        try {
          await server?.close();
        } finally {
          if (shutdownDeadline) {
            clearTimeout(shutdownDeadline);
            shutdownDeadline = null;
          }
          removeProcessListeners();
        }
      })();
      return closePromise;
    };

    const requestSignalClose = (signal: 'SIGINT' | 'SIGTERM'): void => {
      if (closePromise) {
        server?.log.warn(
          { signal },
          'Second shutdown signal received; forcing process exit'
        );
        process.exit(1);
      }
      void close(signal, 0).catch((error: unknown) => {
        server?.log.fatal(
          { signal, err: error },
          'Unable to drain outbound webhook dispatcher'
        );
        process.exit(1);
      });
    };

    function onSigterm(): void {
      requestSignalClose('SIGTERM');
    }

    function onSigint(): void {
      requestSignalClose('SIGINT');
    }

    function onUncaughtException(error: Error): void {
      void close('uncaught_exception', 1, error).catch(() => process.exit(1));
    }

    function onUnhandledRejection(reason: unknown): void {
      void close('unhandled_rejection', 1, reason).catch(() => process.exit(1));
    }

    process.on('SIGTERM', onSigterm);
    process.on('SIGINT', onSigint);
    process.on('uncaughtException', onUncaughtException);
    process.on('unhandledRejection', onUnhandledRejection);
    server.addHook('onClose', async (): Promise<void> => {
      removeProcessListeners();
    });

    await server.listen({ host: '0.0.0.0', port: config.port });
  } catch (error: unknown) {
    if (!server) {
      writeStartupFailure(error);
      process.exitCode = 1;
      return;
    }

    server.log.fatal(
      { err: error },
      'Unable to start outbound webhook dispatcher'
    );
    process.exitCode = 1;
    await server.close().catch((closeError: unknown) => {
      server?.log.error(
        { err: closeError },
        'Unable to close failed webhook dispatcher startup'
      );
    });
  }
};

void start().catch((error: unknown) => {
  writeStartupFailure(error);
  process.exitCode = 1;
});
