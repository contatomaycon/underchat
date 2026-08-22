import type { FastifyInstance } from 'fastify';

type BalanceApiShutdownSignal = 'SIGINT' | 'SIGTERM';

interface IBalanceApiShutdownSignalTarget {
  on(signal: BalanceApiShutdownSignal, listener: () => void): unknown;
  off(signal: BalanceApiShutdownSignal, listener: () => void): unknown;
}

interface IInstallBalanceApiGracefulShutdownOptions {
  signalTarget?: IBalanceApiShutdownSignalTarget;
  timeoutMs?: number;
  forceExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
}

export interface IBalanceApiGracefulShutdownController {
  isShuttingDown(): boolean;
}

export const BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS = 8_000;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS;
const installedControllers = new WeakMap<
  object,
  IBalanceApiGracefulShutdownController
>();

function resolveShutdownTimeoutMs(value: number | undefined): number {
  const configured = Number(process.env.BALANCE_API_SHUTDOWN_TIMEOUT_MS);
  const candidate =
    Number.isSafeInteger(value) && (value as number) > 0
      ? (value as number)
      : Number.isSafeInteger(configured) && configured > 0
        ? configured
        : DEFAULT_SHUTDOWN_TIMEOUT_MS;

  /*
   * `docker stop` gives the process ten seconds by default. Keep a fixed
   * margin so a stuck Fastify close is converted into the original signal's
   * conventional exit code before Docker has to issue an opaque SIGKILL.
   */
  return Math.min(candidate, BALANCE_API_MAX_SHUTDOWN_TIMEOUT_MS);
}

function shutdownExitCode(signal: BalanceApiShutdownSignal): number {
  return signal === 'SIGTERM' ? 143 : 130;
}

/**
 * Drains the Balance API exactly once on Docker/terminal shutdown.
 *
 * Fastify close hooks own the ordered shutdown of gRPC, Redis and the other
 * registered plugins. Centrifugo also installs signal listeners, which means
 * Node no longer performs its default signal exit; this coordinator therefore
 * closes Fastify and exits explicitly with the signal's conventional code.
 */
export function installBalanceApiGracefulShutdown(
  server: Pick<FastifyInstance, 'addHook' | 'close' | 'log'>,
  options: IInstallBalanceApiGracefulShutdownOptions = {}
): IBalanceApiGracefulShutdownController {
  const installedController = installedControllers.get(server);
  if (installedController) {
    return installedController;
  }

  const signalTarget = options.signalTarget ?? process;
  const timeoutMs = resolveShutdownTimeoutMs(options.timeoutMs);
  const forceExit =
    options.forceExit ?? ((code: number): void => process.exit(code));
  const setExitCode =
    options.setExitCode ??
    ((code: number): void => {
      process.exitCode = code;
    });
  let shutdownPromise: Promise<void> | null = null;
  let shutdownDeadline: ReturnType<typeof setTimeout> | null = null;
  let hasRequestedExit = false;
  const controller: IBalanceApiGracefulShutdownController = {
    isShuttingDown: (): boolean => shutdownPromise !== null,
  };
  installedControllers.set(server, controller);

  const clearDeadline = (): void => {
    if (!shutdownDeadline) {
      return;
    }
    clearTimeout(shutdownDeadline);
    shutdownDeadline = null;
  };

  const removeSignalListeners = (): void => {
    signalTarget.off('SIGTERM', onSigterm);
    signalTarget.off('SIGINT', onSigint);
  };

  const requestExit = (code: number): void => {
    if (hasRequestedExit) {
      return;
    }
    hasRequestedExit = true;
    forceExit(code);
  };

  const close = (signal: BalanceApiShutdownSignal): void => {
    if (shutdownPromise) {
      server.log.warn(
        { signal },
        'Balance API shutdown is already in progress'
      );
      return;
    }

    const exitCode = shutdownExitCode(signal);
    setExitCode(exitCode);
    server.log.info(
      { signal, timeout_ms: timeoutMs },
      'Draining Balance API, gRPC and shared clients'
    );

    shutdownDeadline = setTimeout(() => {
      server.log.fatal(
        { signal, timeout_ms: timeoutMs },
        'Balance API graceful shutdown deadline exceeded'
      );
      requestExit(exitCode);
    }, timeoutMs);
    shutdownDeadline.unref?.();

    shutdownPromise = Promise.resolve()
      .then(() => server.close())
      .then(() => {
        server.log.info({ signal }, 'Balance API graceful shutdown completed');
        requestExit(exitCode);
      })
      .catch((error: unknown) => {
        server.log.fatal(
          { signal, err: error },
          'Unable to drain Balance API cleanly'
        );
        requestExit(exitCode);
      })
      .finally(() => {
        clearDeadline();
        removeSignalListeners();
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

  try {
    server.addHook('onClose', async (): Promise<void> => {
      /*
       * Fastify invokes onClose from inside the signal-initiated server.close
       * operation, before the remaining plugin hooks have necessarily drained.
       * Keep both signal listeners installed until that operation settles so a
       * repeated SIGTERM/SIGINT is still observed and deduplicated instead of
       * silently falling through a shutdown window. An unrelated server.close
       * still uninstalls this coordinator immediately.
       */
      if (!shutdownPromise) {
        removeSignalListeners();
      }
    });
  } catch (error) {
    removeSignalListeners();
    installedControllers.delete(server);
    throw error;
  }

  return controller;
}
