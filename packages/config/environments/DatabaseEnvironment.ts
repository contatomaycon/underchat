import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { resolveScopedEnvValue } from './envScope';

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
    const host = resolveScopedEnvValue({
      publicKey: 'DB_PUBLIC_HOST_RW',
      privateKey: 'DB_PRIVATE_HOST_RW',
      legacyKey: 'DB_HOST_RW',
    });
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST_RW is not defined.');
    }

    return host;
  }

  public get dbHostRo(): string {
    const host = resolveScopedEnvValue({
      publicKey: 'DB_PUBLIC_HOST_RO',
      privateKey: 'DB_PRIVATE_HOST_RO',
      legacyKey: 'DB_HOST_RO',
    });
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST_RO is not defined.');
    }

    return host;
  }

  public get dbPortRw(): number {
    const portValue = resolveScopedEnvValue({
      publicKey: 'DB_PUBLIC_PORT_RW',
      privateKey: 'DB_PRIVATE_PORT_RW',
      legacyKey: 'DB_PORT_RW',
    });
    const port = portValue && Number(portValue);
    if (!port) {
      throw new InvalidConfigurationError('DB_PORT_RW is not defined.');
    }

    return port;
  }

  public get dbPortRo(): number {
    const portValue = resolveScopedEnvValue({
      publicKey: 'DB_PUBLIC_PORT_RO',
      privateKey: 'DB_PRIVATE_PORT_RO',
      legacyKey: 'DB_PORT_RO',
    });
    const port = portValue && Number(portValue);
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

  /**
   * Dedicated login used only by WhatsApp runtimes. Session volumes do not
   * remove their operational database dependency (fence, status/config,
   * outbox and S3 fallback), so all three providers use this identity.
   */
  public get workerDbUser(): string {
    const user = process.env.WORKER_DB_USER?.trim();
    if (!user) {
      throw new InvalidConfigurationError('WORKER_DB_USER is not defined.');
    }

    return user;
  }

  public get workerDbPassword(): string {
    const password = process.env.WORKER_DB_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError('WORKER_DB_PASSWORD is not defined.');
    }

    return password;
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
    const value = process.env.DB_POOL_MIN;
    if (value === undefined) {
      throw new InvalidConfigurationError('DB_POOL_MIN is not defined.');
    }

    const min = Number(value);
    if (!Number.isFinite(min) || min < 0) {
      throw new InvalidConfigurationError('DB_POOL_MIN is invalid.');
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

  public get dbAtlas(): string {
    const atlas = resolveScopedEnvValue({
      publicKey: 'DB_PUBLIC_ATLAS',
      privateKey: 'DB_PRIVATE_ATLAS',
      legacyKey: 'DB_ATLAS',
    });
    if (!atlas) {
      throw new InvalidConfigurationError('DB_ATLAS is not defined.');
    }

    return atlas;
  }
}
