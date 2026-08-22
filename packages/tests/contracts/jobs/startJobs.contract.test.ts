import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import startJobs from '@core/jobs';

jest.mock('@core/jobs/cronJobs', () => ({
  cronJobs: jest.fn(() => []),
}));

describe('runtime-role cron job isolation', () => {
  it('does not resolve or schedule cron jobs when the runtime role disables them', () => {
    const server = {
      ready: jest.fn(),
      log: {
        info: jest.fn(),
      },
    } as unknown as FastifyInstance;

    startJobs(server, { enabled: false });

    expect(server.ready).not.toHaveBeenCalled();
    expect(server.log.info).toHaveBeenCalledWith(
      'Cron jobs disabled for this runtime role'
    );
  });

  it('binds Service API cron jobs to the non-build runtime capability', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'apps/service_api/src/index.ts'),
      'utf8'
    );

    expect(source).toContain(
      'enabled: buildEnvironment.serviceApiEnableNonBuildConsumers'
    );
  });
});
