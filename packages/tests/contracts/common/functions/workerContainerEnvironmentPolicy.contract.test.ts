import { buildWorkerContainerDatabaseUrl } from '@core/common/functions/workerContainerEnvironmentPolicy';

describe('worker container database environment policy', () => {
  it('encodes a DSN exclusively from discrete connection fields', () => {
    expect(
      buildWorkerContainerDatabaseUrl({
        host: 'pg-worker.example',
        port: 15_432,
        user: 'worker@tenant',
        password: 'p:/?#[]@ss',
        database: 'under/chat',
        sslMode: 'verify-full',
      })
    ).toBe(
      'postgresql://worker%40tenant:p%3A%2F%3F%23%5B%5D%40ss@pg-worker.example:15432/under%2Fchat?sslmode=verify-full'
    );
  });

  it('supports a discrete IPv6 host', () => {
    expect(
      buildWorkerContainerDatabaseUrl({
        host: '2001:db8::12',
        port: 5_432,
        user: 'worker',
        password: 'secret',
        database: 'underchat',
        sslMode: 'disable',
      })
    ).toBe(
      'postgresql://worker:secret@[2001:db8::12]:5432/underchat?sslmode=disable'
    );
  });

  it('fails closed when a discrete field is absent or invalid', () => {
    expect(() =>
      buildWorkerContainerDatabaseUrl({
        host: '',
        port: 5_432,
        user: 'worker',
        password: 'secret',
        database: 'underchat',
        sslMode: 'disable',
      })
    ).toThrow('worker_database_configuration_invalid');
  });
});
