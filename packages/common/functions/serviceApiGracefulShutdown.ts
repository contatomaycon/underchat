import type { FastifyInstance } from 'fastify';

type ServiceApiShutdownSignal = 'SIGINT' | 'SIGTERM';

interface IServiceApiShutdownSignalTarget {
  on(signal: ServiceApiShutdownSignal, listener: () => void): unknown;
  off(signal: ServiceApiShutdownSignal, listener: () => void): unknown;
}

interface IInstallServiceApiGracefulShutdownOptions {
  signalTarget?: IServiceApiShutdownSignalTarget;
  timeoutMs?: number;
  forceExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 45_000;

function shutdownExitCode(signal: ServiceApiShutdownSignal): number {
  return signal === 'SIGTERM' ? 143 : 130;
}

function resolveShutdownTimeoutMs(value: number | undefined): number {
  if (Number.isSafeInteger(value) && (value as number) > 0) {
    return value as number;
  }

  const configured = Number(process.env.SERVICE_API_SHUTDOWN_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

/**
 * Installs the process-level drain required by Kubernetes. The Centrifugo
 * plugin also listens for SIGTERM, which disables Node's default signal exit,
 * so the Service API itself must explicitly close Fastify. Closing Fastify is
 * what runs the Kafka consumer onClose hooks and revokes the old group members
 * before a replacement generation is allowed to start.
 */
export function installServiceApiGracefulShutdown(
  server: Pick<FastifyInstance, 'addHook' | 'close' | 'log'>,
  options: IInstallServiceApiGracefulShutdownOptions = {}
): void {
  const signalTarget = options.signalTarget ?? process;
  const timeoutMs = resolveShutdownTimeoutMs(options.timeoutMs);
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code));
  const setExitCode =
    options.setExitCode ??
    ((code: number): void => {
      process.exitCode = code;
    });
  let closePromise: Promise<void> | null = null;
  let shutdownDeadline: ReturnType<typeof setTimeout> | null = null;
  let exitRequested = false;

  const clearDeadline = (): void => {
    if (!shutdownDeadline) return;
    clearTimeout(shutdownDeadline);
    shutdownDeadline = null;
  };

  const removeSignalListeners = (): void => {
    signalTarget.off('SIGTERM', onSigterm);
    signalTarget.off('SIGINT', onSigint);
  };

  const requestExit = (code: number): void => {
    if (exitRequested) return;
    exitRequested = true;
    clearDeadline();
    removeSignalListeners();
    forceExit(code);
  };

  const close = (signal: ServiceApiShutdownSignal): void => {
    if (closePromise) {
      server.log.warn(
        { signal },
        'Second shutdown signal received; forcing Service API exit'
      );
      requestExit(1);
      return;
    }

    server.log.info(
      { signal, timeout_ms: timeoutMs },
      'Draining Service API and Kafka consumers'
    );
    const exitCode = shutdownExitCode(signal);
    setExitCode(exitCode);
    shutdownDeadline = setTimeout(() => {
      server.log.fatal(
        { signal, timeout_ms: timeoutMs },
        'Service API graceful shutdown deadline exceeded'
      );
      requestExit(1);
    }, timeoutMs);
    shutdownDeadline.unref?.();

    closePromise = Promise.resolve()
      .then(() => server.close())
      .then(() => {
        /*
         * Let Node terminate naturally after a clean Fastify close. This gives
         * any task that crossed a runner's warning threshold the remainder of
         * the process deadline to settle. An orphaned librdkafka native handle
         * keeps the event loop alive and is still cut off by the deadline.
         */
        server.log.info(
          { signal, exit_code: exitCode },
          'Service API graceful shutdown completed'
        );
      })
      .catch((error: unknown) => {
        server.log.fatal(
          { signal, err: error },
          'Unable to drain Service API cleanly'
        );
        requestExit(1);
      })
      .finally(() => {
        if (exitRequested) {
          clearDeadline();
          removeSignalListeners();
        }
      });
  };

  function onSigterm(): void {
    close('SIGTERM');
  }

  function onSigint(): void {
    close('SIGINT');
  }

  signalTarget.on('SIGTERM', onSigterm);
  signalTarget.on('SIGINT', onSigint);
  server.addHook('onClose', async (): Promise<void> => {
    /*
     * Keep signal handling active while a signal-initiated close is draining
     * other hooks. An unrelated programmatic server.close() still removes it.
     */
    if (!closePromise) {
      removeSignalListeners();
    }
  });
}
