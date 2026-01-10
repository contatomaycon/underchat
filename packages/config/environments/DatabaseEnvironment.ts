import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

type DatabaseSslMode =
  | 'disable'
  | 'allow'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full'
  | 'no-verify';

const SSL_MODE_ALIASES: Partial<Record<string, DatabaseSslMode>> = {
  true: 'require',
  '1': 'require',
  yes: 'require',
  false: 'disable',
  '0': 'disable',
  no: 'disable',
};

const SSL_MODE_VALUES = new Set<DatabaseSslMode>([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
  'no-verify',
]);

export class DatabaseEnvironment {
  public get dbHostRw(): string {
    const host = process.env.DB_HOST_RW;
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST_RW is not defined.');
    }

    return host;
  }

  public get dbHostRo(): string {
    const host = process.env.DB_HOST_RO;
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST_RO is not defined.');
    }

    return host;
  }

  public get dbPortRw(): number {
    const port = process.env.DB_PORT_RW && Number(process.env.DB_PORT_RW);
    if (!port) {
      throw new InvalidConfigurationError('DB_PORT_RW is not defined.');
    }

    return port;
  }

  public get dbPortRo(): number {
    const port = process.env.DB_PORT_RO && Number(process.env.DB_PORT_RO);
    if (!port) {
      throw new InvalidConfigurationError('DB_PORT_RO is not defined.');
    }

    return port;
  }

  public get dbUser(): string {
    const user = process.env.DB_USER;
    if (!user) {
      throw new InvalidConfigurationError('DB_USER is not defined.');
    }

    return user;
  }

  public get dbPassword(): string {
    const pw = process.env.DB_PASSWORD;
    if (!pw) {
      throw new InvalidConfigurationError('DB_PASSWORD is not defined.');
    }

    return pw;
  }

  public get dbDatabase(): string {
    const db = process.env.DB_DATABASE;
    if (!db) {
      throw new InvalidConfigurationError('DB_DATABASE is not defined.');
    }

    return db;
  }

  public get dbSslMode(): DatabaseSslMode {
    const sm = process.env.DB_SSLMODE;
    if (sm === undefined) {
      throw new InvalidConfigurationError('DB_SSLMODE is not defined.');
    }

    const normalized = sm.trim().toLowerCase();
    const alias = SSL_MODE_ALIASES[normalized];
    if (alias) {
      return alias;
    }

    if (!SSL_MODE_VALUES.has(normalized as DatabaseSslMode)) {
      throw new InvalidConfigurationError(`DB_SSLMODE is invalid: ${sm}.`);
    }

    return normalized as DatabaseSslMode;
  }

  public get dbPoolMin(): number {
    const min = process.env.DB_POOL_MIN && Number(process.env.DB_POOL_MIN);
    if (!min) {
      throw new InvalidConfigurationError('DB_POOL_MIN is not defined.');
    }

    return min;
  }

  public get dbPoolIdleTimeout(): number {
    const idleTimeout =
      process.env.DB_POOL_IDLE_TIMEOUT &&
      Number(process.env.DB_POOL_IDLE_TIMEOUT);

    if (!idleTimeout) {
      throw new InvalidConfigurationError(
        'DB_POOL_IDLE_TIMEOUT is not defined.'
      );
    }

    return idleTimeout;
  }

  public get dbPoolAcquireTimeout(): number {
    const acquireTimeout =
      process.env.DB_POOL_ACQUIRE_TIMEOUT &&
      Number(process.env.DB_POOL_ACQUIRE_TIMEOUT);

    if (!acquireTimeout) {
      throw new InvalidConfigurationError(
        'DB_POOL_ACQUIRE_TIMEOUT is not defined.'
      );
    }

    return acquireTimeout;
  }

  public get dbPoolMax(): number {
    const max = process.env.DB_POOL_MAX && Number(process.env.DB_POOL_MAX);
    if (!max) {
      throw new InvalidConfigurationError('DB_POOL_MAX is not defined.');
    }

    return max;
  }

  public get dbDatabaseUrl(): string {
    const url = process.env.DB_DATABASE_URL;
    if (!url) {
      throw new InvalidConfigurationError('DB_DATABASE_URL is not defined.');
    }

    return url;
  }

  public get dbAtlas(): string {
    const atlas = process.env.DB_ATLAS;
    if (!atlas) {
      throw new InvalidConfigurationError('DB_ATLAS is not defined.');
    }

    return atlas;
  }
}
