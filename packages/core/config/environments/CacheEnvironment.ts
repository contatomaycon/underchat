import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class CacheEnvironment {
  private readonly DB_CACHE_HOST: string | undefined;
  private readonly DB_CACHE_PORT: string | undefined;
  private readonly DB_CACHE_PASSWORD: string | undefined;

  constructor() {
    this.DB_CACHE_HOST = process.env.DB_CACHE_HOST;
    this.DB_CACHE_PORT = process.env.DB_CACHE_PORT;
    this.DB_CACHE_PASSWORD = process.env.DB_CACHE_PASSWORD;
  }

  public get cacheHost(): string {
    const host = this.DB_CACHE_HOST;

    if (!host) {
      throw new InvalidConfigurationError('DB_CACHE_HOST is not defined.');
    }

    return host;
  }

  public get cachePort(): number {
    const port = this.DB_CACHE_PORT && Number(this.DB_CACHE_PORT);
    if (!port) {
      throw new InvalidConfigurationError('DB_CACHE_PORT is not defined.');
    }

    return port;
  }

  public get cachePassword(): string | undefined {
    return this.DB_CACHE_PASSWORD;
  }
}
