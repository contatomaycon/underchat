import type { FastifyInstance } from 'fastify';

type NodeWorkerShutdownSignal = 'SIGINT' | 'SIGTERM';

interface INodeWorkerShutdownSignalTarget {
  on(signal: NodeWorkerShutdownSignal, listener: () => void): unknown;
  off(signal: NodeWorkerShutdownSignal, listener: () => void): unknown;
}

interface IInstallNodeWorkerGracefulShutdownOptions {
  signalTarget?: INodeWorkerShutdownSignalTarget;
  timeoutMs?: number;
  forceExit?: (code: number) => void;
  setExitCode?: (code: number) => void;
  workerName: string;
}

export interface INodeWorkerGracefulShutdownController {
  isShuttingDown(): boolean;
}

/*
 * Docker waits this long after SIGTERM before it escalates to SIGKILL. The
 * Node deadline below deliberately leaves five seconds for logging, tini
 * reaping and Docker to observe the conventional process exit.
 */
export const NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS = 30;
export const NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS = 25_000;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS;
const installedControllers = new WeakMap<
  object,
  INodeWorkerGracefulShutdownController
>();

function resolveShutdownTimeoutMs(value: number | undefined): number {
  const configured = Number(process.env.WORKER_NODE_SHUTDOWN_TIMEOUT_MS);
  const candidate =
    Number.isSafeInteger(value) && (value as number) > 0
      ? (value as number)
      : Number.isSafeInteger(configured) && configured > 0
        ? configured
        : DEFAULT_SHUTDOWN_TIMEOUT_MS;

  return Math.min(candidate, NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS);
}

function shutdownExitCode(signal: NodeWorkerShutdownSignal): number {
  return signal === 'SIGTERM' ? 143 : 130;
}

/**
 * Drains a Node WhatsApp worker exactly once on Docker/terminal shutdown.
 *
 * Fastify close hooks own the ordered shutdown of Kafka consumers, gRPC,
 * Redis and the provider runtime. Centrifugo also installs signal listeners,
 * which disables Node's default signal exit, so this coordinator must close
 * Fastify and explicitly preserve the signal's conventional exit code.
 */
export function installNodeWorkerGracefulShutdown(
  server: Pick<FastifyInstance, 'addHook' | 'close' | 'log'>,
  options: IInstallNodeWorkerGracefulShutdownOptions
): INodeWorkerGracefulShutdownController {
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
  const workerName = options.workerName.trim() || 'Node worker';
  let shutdownPromise: Promise<void> | null = null;
  let shutdownDeadline: ReturnType<typeof setTimeout> | null = null;
  let hasRequestedExit = false;
  const controller: INodeWorkerGracefulShutdownController = {
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

  const close = (signal: NodeWorkerShutdownSignal): void => {
    if (shutdownPromise) {
      server.log.warn(
        { signal, worker: workerName },
        'Node worker shutdown is already in progress'
      );
      return;
    }

    const exitCode = shutdownExitCode(signal);
    setExitCode(exitCode);
    server.log.info(
      { signal, timeout_ms: timeoutMs, worker: workerName },
      'Draining Node worker, Kafka consumers and provider runtime'
    );

    shutdownDeadline = setTimeout(() => {
      server.log.fatal(
        { signal, timeout_ms: timeoutMs, worker: workerName },
        'Node worker graceful shutdown deadline exceeded'
      );
      requestExit(exitCode);
    }, timeoutMs);
    shutdownDeadline.unref?.();

    shutdownPromise = Promise.resolve()
      .then(() => server.close())
      .then(() => {
        server.log.info(
          { signal, worker: workerName },
          'Node worker graceful shutdown completed'
        );
        requestExit(exitCode);
      })
      .catch((error: unknown) => {
        server.log.fatal(
          { signal, err: error, worker: workerName },
          'Unable to drain Node worker cleanly'
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
       * Keep the listeners until a signal-initiated drain settles, so a
       * repeated signal is observed and cannot start a second Fastify close.
       * An unrelated server.close() still uninstalls this coordinator.
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
