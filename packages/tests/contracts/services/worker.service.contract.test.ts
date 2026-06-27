import 'reflect-metadata';

import { APP_TIMEZONE } from '@core/common/constants/timezone';
import { WorkerService } from '@core/services/worker.service';

type WorkerServicePrivate = {
  buildContainerEnv: (overrides: string[]) => string[];
  getAllowedEnv: (env: string[] | undefined) => Record<string, string>;
};

const ENV_DEPENDENCY_COUNT = 27;

const makeService = (): WorkerServicePrivate =>
  new WorkerService(
    ...(Array.from(
      { length: ENV_DEPENDENCY_COUNT },
      () => ({})
    ) as ConstructorParameters<typeof WorkerService>)
  ) as unknown as WorkerServicePrivate;

const envArrayToMap = (env: string[]): Map<string, string> => {
  return new Map(
    env.map((entry) => {
      const separatorIndex = entry.indexOf('=');

      return [entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1)];
    })
  );
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
};

describe('WorkerService timezone container env', () => {
  const originalTz = process.env.TZ;
  const originalPgTz = process.env.PGTZ;

  afterEach(() => {
    restoreEnv('TZ', originalTz);
    restoreEnv('PGTZ', originalPgTz);
  });

  it('adds Sao Paulo timezone env when parent process does not define it', () => {
    delete process.env.TZ;
    delete process.env.PGTZ;

    const service = makeService();
    const env = envArrayToMap(
      service.buildContainerEnv(['WORKER_ID=worker-1'])
    );

    expect(env.get('TZ')).toBe(APP_TIMEZONE);
    expect(env.get('PGTZ')).toBe(APP_TIMEZONE);
  });

  it('forces Sao Paulo timezone over inherited or override values', () => {
    process.env.TZ = 'UTC';
    process.env.PGTZ = 'UTC';

    const service = makeService();
    const env = envArrayToMap(
      service.buildContainerEnv(['TZ=UTC', 'PGTZ=UTC'])
    );

    expect(env.get('TZ')).toBe(APP_TIMEZONE);
    expect(env.get('PGTZ')).toBe(APP_TIMEZONE);
  });

  it('exposes timezone env in safe container inspection diagnostics', () => {
    const service = makeService();

    expect(
      service.getAllowedEnv([
        `TZ=${APP_TIMEZONE}`,
        `PGTZ=${APP_TIMEZONE}`,
        'PASSWORD=secret',
      ])
    ).toEqual({
      TZ: APP_TIMEZONE,
      PGTZ: APP_TIMEZONE,
    });
  });
});
