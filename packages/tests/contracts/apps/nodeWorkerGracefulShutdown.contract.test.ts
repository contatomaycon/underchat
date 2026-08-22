import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  installNodeWorkerGracefulShutdown,
  NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS,
  NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS,
} from '@core/common/functions/nodeWorkerGracefulShutdown';

const PROJECT_ROOT = resolve(__dirname, '../../../../');

function readProjectFile(relativePath: string): string {
  return readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
}

function buildServer(close: () => Promise<void>) {
  return {
    addHook: jest.fn(),
    close: jest.fn(close),
    log: {
      fatal: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
}

describe('Node worker graceful shutdown contract', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ] as const)(
    'drains Fastify exactly once and preserves the conventional %s exit code',
    async (signal, expectedExitCode) => {
      const signalTarget = new EventEmitter();
      const forceExit = jest.fn<void, [number]>();
      const setExitCode = jest.fn<void, [number]>();
      const server = buildServer(async () => undefined);

      const controller = installNodeWorkerGracefulShutdown(server as never, {
        forceExit,
        setExitCode,
        signalTarget,
        timeoutMs: 100,
        workerName: 'contract-worker',
      });
      const duplicateController = installNodeWorkerGracefulShutdown(
        server as never,
        {
          forceExit,
          setExitCode,
          signalTarget,
          timeoutMs: 100,
          workerName: 'contract-worker',
        }
      );

      expect(duplicateController).toBe(controller);
      expect(controller.isShuttingDown()).toBe(false);

      signalTarget.emit(signal);
      signalTarget.emit(signal);
      expect(controller.isShuttingDown()).toBe(true);
      await flushPromises();

      expect(server.close).toHaveBeenCalledTimes(1);
      expect(setExitCode).toHaveBeenCalledTimes(1);
      expect(setExitCode).toHaveBeenCalledWith(expectedExitCode);
      expect(forceExit).toHaveBeenCalledTimes(1);
      expect(forceExit).toHaveBeenCalledWith(expectedExitCode);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    }
  );

  it('forces a stuck drain before Docker reaches its configured stop deadline', async () => {
    jest.useFakeTimers();
    const signalTarget = new EventEmitter();
    const forceExit = jest.fn<void, [number]>();
    const server = buildServer(
      () =>
        new Promise<void>(() => {
          // Deliberately never resolves: models a stuck provider close hook.
        })
    );

    installNodeWorkerGracefulShutdown(server as never, {
      forceExit,
      setExitCode: jest.fn(),
      signalTarget,
      timeoutMs: 60_000,
      workerName: 'stuck-worker',
    });

    signalTarget.emit('SIGTERM');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(
      NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS - 1
    );
    expect(forceExit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(143);
    expect(NODE_WORKER_MAX_SHUTDOWN_TIMEOUT_MS).toBeLessThan(
      NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS * 1_000
    );

    signalTarget.emit('SIGINT');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
  });

  it('marks shutdown synchronously so a startup rejection cannot become exit 1', async () => {
    const signalTarget = new EventEmitter();
    const startupFailureExit = jest.fn<void, [number]>();
    const server = buildServer(async () => undefined);
    const controller = installNodeWorkerGracefulShutdown(server as never, {
      forceExit: jest.fn(),
      setExitCode: jest.fn(),
      signalTarget,
      timeoutMs: 100,
      workerName: 'starting-worker',
    });

    signalTarget.emit('SIGTERM');

    if (!controller.isShuttingDown()) {
      startupFailureExit(1);
    }

    expect(controller.isShuttingDown()).toBe(true);
    expect(startupFailureExit).not.toHaveBeenCalled();
    await flushPromises();
  });

  it('installs the coordinator and startup guard in both Node worker apps', () => {
    const workerIndexes = [
      'apps/worker_baileys/src/index.ts',
      'apps/worker_wwebjs/src/index.ts',
    ].map(readProjectFile);

    for (const indexSource of workerIndexes) {
      expect(indexSource).toContain('installNodeWorkerGracefulShutdown(server');
      expect(indexSource).toMatch(
        /catch \(err\) \{\s+if \(nodeWorkerShutdown\.isShuttingDown\(\)\) \{\s+return;\s+\}/u
      );
      expect(indexSource).toMatch(
        /nodeWorkerShutdown\.isShuttingDown\(\)[\s\S]*process\.exit\(1\)/u
      );
    }
  });

  it('pins one tini, SIGTERM and the longer Docker stop deadline on every path', () => {
    const dockerfiles = [
      'apps/worker_baileys/Dockerfile',
      'apps/worker_wwebjs/Dockerfile',
      'apps/worker_whatsmeow/Dockerfile',
    ].map(readProjectFile);
    const workerService = readProjectFile(
      'packages/services/worker.service.ts'
    );

    for (const dockerfile of dockerfiles) {
      expect(dockerfile).toContain('ARG TINI_VERSION=0.19.0-1+b3');
      expect(dockerfile).toContain('STOPSIGNAL SIGTERM');
      expect(
        dockerfile.split(
          'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/worker-liveness-entrypoint"]'
        )
      ).toHaveLength(2);
    }
    expect(
      workerService.match(
        /StopTimeout: NODE_WORKER_CONTAINER_STOP_TIMEOUT_SECONDS/gu
      )
    ).toHaveLength(2);
    expect(workerService).toContain('Init: false');
  });
});
