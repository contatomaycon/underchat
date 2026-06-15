import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import { resolveScopedEnvValue } from './envScope';

export class CacheEnvironment {
  public get cacheHost(): string {
    const host = resolveScopedEnvValue({
      publicKey: 'DB_CACHE_PUBLIC_HOST',
      privateKey: 'DB_CACHE_PRIVATE_HOST',
      legacyKey: 'DB_CACHE_HOST',
    });

    if (!host) {
      throw new InvalidConfigurationError('DB_CACHE_HOST is not defined.');
    }

    return host;
  }

  public get cachePort(): number {
    const portValue = resolveScopedEnvValue({
      publicKey: 'DB_CACHE_PUBLIC_PORT',
      privateKey: 'DB_CACHE_PRIVATE_PORT',
      legacyKey: 'DB_CACHE_PORT',
    });
    const port = portValue && Number(portValue);
    if (!port) {
      throw new InvalidConfigurationError('DB_CACHE_PORT is not defined.');
    }

    return port;
  }

  public get cachePassword(): string | undefined {
    return process.env.DB_CACHE_PASSWORD;
  }
}
