import 'reflect-metadata';

import fastify from 'fastify';
import { container } from 'tsyringe';
import workerDatabasePlugin from '@core/plugins/workerDatabase';
import {
  closeWorkerPostgresPool,
  getWorkerPostgresPool,
  getWorkerScopedPostgresPool,
} from '@core/services/workerPostgresPool';
import { EWorkerType } from '@core/common/enums/EWorkerType';

jest.mock('@core/services/workerPostgresPool', () => ({
  getWorkerPostgresPool: jest.fn(),
  getWorkerScopedPostgresPool: jest.fn(),
  closeWorkerPostgresPool: jest.fn(async () => undefined),
}));

describe('worker database plugin', () => {
  const runtimeEnvironment = [
    'WORKER_ID',
    'ACCOUNT_ID',
    'WORKER_TYPE_ID',
    'RUNTIME_GENERATION',
    'WORKER_WRITER_EPOCH',
    'WORKER_RUNTIME_CAPABILITY',
    'WORKER_SESSION_STORAGE',
    'WARM_STANDBY',
    'HOSTNAME',
  ] as const;
  const originalEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of runtimeEnvironment) {
      originalEnvironment.set(key, process.env[key]);
    }
    process.env.WORKER_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5d';
    process.env.ACCOUNT_ID = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5e';
    process.env.WORKER_TYPE_ID = EWorkerType.baileys;
    process.env.RUNTIME_GENERATION = '1';
    process.env.WORKER_WRITER_EPOCH = '019c1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5f';
    process.env.WORKER_RUNTIME_CAPABILITY = 'c'.repeat(48);
    process.env.WORKER_SESSION_STORAGE = 'postgres';
    process.env.WARM_STANDBY = 'false';
    process.env.HOSTNAME = 'worker-container-id';
  });

  afterEach(() => {
    container.reset();
    for (const key of runtimeEnvironment) {
      const original = originalEnvironment.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
    originalEnvironment.clear();
  });

  it('registers RW and RO Drizzle on the one worker pool and closes it once', async () => {
    const sharedPool = {
      query: jest.fn(async () => ({
        rows: [{ activated: true, connection_sequence: 1 }],
      })),
      on: jest.fn(),
    };
    jest.mocked(getWorkerPostgresPool).mockReturnValue(sharedPool as never);
    jest
      .mocked(getWorkerScopedPostgresPool)
      .mockReturnValue(sharedPool as never);
    const server = fastify({ logger: false });

    await server.register(workerDatabasePlugin);
    await server.ready();

    expect(getWorkerPostgresPool).toHaveBeenCalledTimes(1);
    expect(getWorkerScopedPostgresPool).toHaveBeenCalledTimes(1);
    expect(container.isRegistered('DatabaseRw')).toBe(true);
    expect(container.isRegistered('DatabaseRo')).toBe(true);
    expect(container.resolve('DatabaseRw')).toBe(
      container.resolve('DatabaseRo')
    );

    await server.close();
    expect(closeWorkerPostgresPool).toHaveBeenCalledTimes(1);
  });
});
