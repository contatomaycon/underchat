import { EventEmitter } from 'node:events';
import { installServiceApiGracefulShutdown } from '@core/common/functions/serviceApiGracefulShutdown';

class FakeSignalTarget extends EventEmitter {}

describe('Service API graceful shutdown', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes Fastify on SIGTERM so Kafka onClose drains before process exit', async () => {
    const signalTarget = new FakeSignalTarget();
    const onCloseHooks: Array<() => Promise<void>> = [];
    const forceExit = jest.fn();
    const setExitCode = jest.fn();
    const server = {
      addHook: jest.fn(
        (_name: 'onClose', hook: () => Promise<void>) =>
          void onCloseHooks.push(hook)
      ),
      close: jest.fn(async () => {
        await Promise.all(onCloseHooks.map((hook) => hook()));
      }),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode,
    });

    signalTarget.emit('SIGTERM');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(143);
    expect(forceExit).not.toHaveBeenCalled();
    expect(signalTarget.listenerCount('SIGTERM')).toBe(1);
    expect(signalTarget.listenerCount('SIGINT')).toBe(1);

    signalTarget.emit('SIGTERM');
  });

  it('uses the conventional SIGINT exit code after a clean drain', async () => {
    const signalTarget = new FakeSignalTarget();
    const forceExit = jest.fn();
    const setExitCode = jest.fn();
    const server = {
      addHook: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode,
    });

    signalTarget.emit('SIGINT');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(130);
    expect(forceExit).not.toHaveBeenCalled();

    signalTarget.emit('SIGINT');
  });

  it('never starts a second Fastify close and forces a repeated signal', async () => {
    const signalTarget = new FakeSignalTarget();
    const forceExit = jest.fn();
    const server = {
      addHook: jest.fn(),
      close: jest.fn(() => new Promise<void>(() => undefined)),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode: jest.fn(),
    });

    signalTarget.emit('SIGTERM');
    signalTarget.emit('SIGINT');
    await Promise.resolve();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it('forces exit when the graceful drain exceeds its deadline', async () => {
    jest.useFakeTimers();
    const signalTarget = new FakeSignalTarget();
    const forceExit = jest.fn();
    const server = {
      addHook: jest.fn(),
      close: jest.fn(() => new Promise<void>(() => undefined)),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode: jest.fn(),
    });

    signalTarget.emit('SIGTERM');
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it('keeps the deadline active while another Fastify onClose hook is pending', async () => {
    jest.useFakeTimers();
    const signalTarget = new FakeSignalTarget();
    const forceExit = jest.fn();
    const onCloseHooks: Array<() => Promise<void>> = [
      () => new Promise<void>(() => undefined),
    ];
    const server = {
      addHook: jest.fn(
        (_name: 'onClose', hook: () => Promise<void>) =>
          void onCloseHooks.push(hook)
      ),
      close: jest.fn(async () => {
        await Promise.all(onCloseHooks.map((hook) => hook()));
      }),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode: jest.fn(),
    });

    signalTarget.emit('SIGTERM');
    await Promise.resolve();
    await Promise.resolve();

    expect(signalTarget.listenerCount('SIGTERM')).toBe(1);
    expect(signalTarget.listenerCount('SIGINT')).toBe(1);
    jest.advanceTimersByTime(1_000);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it('logs and exits non-zero when Fastify cannot drain', async () => {
    const signalTarget = new FakeSignalTarget();
    const forceExit = jest.fn();
    const closeError = new Error('shutdown_failed');
    const server = {
      addHook: jest.fn(),
      close: jest.fn().mockRejectedValue(closeError),
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        fatal: jest.fn(),
      },
    };

    installServiceApiGracefulShutdown(server as never, {
      signalTarget,
      timeoutMs: 1_000,
      forceExit,
      setExitCode: jest.fn(),
    });

    signalTarget.emit('SIGTERM');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(server.log.fatal).toHaveBeenCalledWith(
      { signal: 'SIGTERM', err: closeError },
      'Unable to drain Service API cleanly'
    );
    expect(forceExit).toHaveBeenCalledWith(1);
  });
});
