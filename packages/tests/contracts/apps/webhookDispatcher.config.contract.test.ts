import { readAliasedIntegerEnvironment } from '@core/common/functions/readAliasedIntegerEnvironment';

const TIMEOUT_ENV_KEYS = [
  'WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS',
  'WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS',
] as const;

describe('webhook dispatcher database timeout configuration', () => {
  const previousEnvironment: Partial<Record<string, string | undefined>> = {};

  beforeAll(() => {
    for (const key of TIMEOUT_ENV_KEYS) {
      previousEnvironment[key] = process.env[key];
    }
  });

  beforeEach(() => {
    for (const key of TIMEOUT_ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reads the PgBouncer-safe query timeout variable', () => {
    process.env.WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS = '12000';

    expect(readTimeout()).toBe(12_000);
  });

  it('accepts the legacy statement timeout name during rolling upgrades', () => {
    process.env.WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS = '13000';

    expect(readTimeout()).toBe(13_000);
  });

  it('rejects conflicting preferred and legacy values', () => {
    process.env.WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS = '12000';
    process.env.WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS = '13000';

    expect(readTimeout).toThrow(
      'WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS and WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS must match'
    );
  });
});

const readTimeout = (): number =>
  readAliasedIntegerEnvironment({
    key: 'WEBHOOK_DISPATCHER_DB_QUERY_TIMEOUT_MS',
    legacyKey: 'WEBHOOK_DISPATCHER_DB_STATEMENT_TIMEOUT_MS',
    fallback: 30_000,
    minimum: 1_000,
    maximum: 55_000,
  });
