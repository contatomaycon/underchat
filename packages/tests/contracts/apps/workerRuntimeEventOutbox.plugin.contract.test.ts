import 'reflect-metadata';

import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { container } from 'tsyringe';
import { WorkerRuntimeEventOutboxService } from '@core/services/workerRuntimeEventOutbox.service';
import { WorkerSelfHealRequestDispatcherService } from '@core/services/workerSelfHealRequestDispatcher.service';

const { default: durableDispatchPlugin, workerRuntimeEventOutboxPlugin } =
  jest.requireActual<{
    default: FastifyPluginAsync;
    workerRuntimeEventOutboxPlugin: FastifyPluginAsync;
  }>(
    path.join(
      process.cwd(),
      'apps/service_api/src/plugins/workerRuntimeEventOutbox.plugin.ts'
    )
  );

describe('worker runtime durable dispatch plugin', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('depends on the names actually assigned by the service safePlugin wrappers', () => {
    const metadata = (
      durableDispatchPlugin as unknown as Record<
        symbol,
        { dependencies?: string[] }
      >
    )[Symbol.for('plugin-meta')];

    expect(metadata.dependencies).toEqual(['database', 'redis', 'centrifugo']);
  });

  it('starts both durable drains on listen and awaits both during shutdown', async () => {
    const outbox = {
      start: jest.fn(),
      close: jest.fn(async () => undefined),
    };
    const selfHealDispatcher = {
      start: jest.fn(),
      close: jest.fn(async () => undefined),
    };
    jest.spyOn(container, 'resolve').mockImplementation((token) => {
      if (token === WorkerRuntimeEventOutboxService) return outbox as never;
      if (token === WorkerSelfHealRequestDispatcherService) {
        return selfHealDispatcher as never;
      }
      throw new Error(`Unexpected dependency: ${String(token)}`);
    });

    const hooks = new Map<string, (...args: never[]) => unknown>();
    const logError = jest.fn();
    const server = {
      log: { error: logError },
      addHook: jest.fn(
        (name: string, hook: (...args: never[]) => unknown): void => {
          hooks.set(name, hook);
        }
      ),
    };

    await workerRuntimeEventOutboxPlugin(server as never, {});
    hooks.get('onListen')?.();

    expect(outbox.start).toHaveBeenCalledTimes(1);
    expect(selfHealDispatcher.start).toHaveBeenCalledTimes(1);
    const outboxOnError = outbox.start.mock.calls[0]?.[0].onError;
    const selfHealOnError = selfHealDispatcher.start.mock.calls[0]?.[0].onError;
    outboxOnError(new Error('sensitive outbox detail'));
    selfHealOnError(new Error('sensitive dispatcher detail'));
    expect(logError).toHaveBeenCalledWith(
      {
        error_name: 'Error',
        type: 'worker_runtime_event_outbox_drain_failed',
      },
      'Worker runtime event outbox drain failed'
    );
    expect(logError).toHaveBeenCalledWith(
      {
        error_name: 'Error',
        type: 'worker_self_heal_dispatch_failed',
      },
      'Worker self-heal request dispatch failed'
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      'sensitive dispatcher detail'
    );

    await hooks.get('onClose')?.();
    expect(outbox.close).toHaveBeenCalledTimes(1);
    expect(selfHealDispatcher.close).toHaveBeenCalledTimes(1);
  });
});
