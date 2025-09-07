import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class CacheEnvironment {
  public get cacheHost(): string {
    const host = process.env.DB_CACHE_HOST;

    if (!host) {
      throw new InvalidConfigurationError('DB_CACHE_HOST is not defined.');
    }

    return host;
  }

  public get cachePort(): number {
    const port = process.env.DB_CACHE_PORT && Number(process.env.DB_CACHE_PORT);
    if (!port) {
      throw new InvalidConfigurationError('DB_CACHE_PORT is not defined.');
    }

    return port;
  }

  public get cachePassword(): string | undefined {
    return process.env.DB_CACHE_PASSWORD;
  }
}
