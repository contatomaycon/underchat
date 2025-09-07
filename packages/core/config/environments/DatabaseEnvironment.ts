import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class DatabaseEnvironment {
  public get dbHost(): string {
    const host = process.env.DB_HOST;
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST is not defined.');
    }

    return host;
  }

  public get dbPort(): number {
    const port = process.env.DB_PORT && Number(process.env.DB_PORT);
    if (!port) {
      throw new InvalidConfigurationError('DB_PORT is not defined.');
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

  public get dbSslMode(): boolean {
    const sm = process.env.DB_SSLMODE;
    if (sm === undefined) {
      throw new InvalidConfigurationError('DB_SSLMODE is not defined.');
    }

    return sm === 'true';
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
