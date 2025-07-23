import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class DatabaseEnvironment {
  private readonly DB_HOST: string | undefined;
  private readonly DB_PORT: string | undefined;
  private readonly DB_USER: string | undefined;
  private readonly DB_PASSWORD: string | undefined;
  private readonly DB_DATABASE: string | undefined;
  private readonly DB_SSLMODE: string | undefined;
  private readonly DB_DATABASE_URL: string | undefined;
  private readonly DB_ATLAS: string | undefined;

  constructor() {
    this.DB_HOST = process.env.DB_HOST;
    this.DB_PORT = process.env.DB_PORT;
    this.DB_USER = process.env.DB_USER;
    this.DB_PASSWORD = process.env.DB_PASSWORD;
    this.DB_DATABASE = process.env.DB_DATABASE;
    this.DB_SSLMODE = process.env.DB_SSLMODE;
    this.DB_DATABASE_URL = process.env.DB_DATABASE_URL;
    this.DB_ATLAS = process.env.DB_ATLAS;
  }

  public get dbHost(): string {
    const host = this.DB_HOST;
    if (!host) {
      throw new InvalidConfigurationError('DB_HOST is not defined.');
    }

    return host;
  }

  public get dbPort(): number {
    const port = this.DB_PORT && Number(this.DB_PORT);
    if (!port) {
      throw new InvalidConfigurationError('DB_PORT is not defined.');
    }

    return port;
  }

  public get dbUser(): string {
    const user = this.DB_USER;
    if (!user) {
      throw new InvalidConfigurationError('DB_USER is not defined.');
    }

    return user;
  }

  public get dbPassword(): string {
    const pw = this.DB_PASSWORD;
    if (!pw) {
      throw new InvalidConfigurationError('DB_PASSWORD is not defined.');
    }

    return pw;
  }

  public get dbDatabase(): string {
    const db = this.DB_DATABASE;
    if (!db) {
      throw new InvalidConfigurationError('DB_DATABASE is not defined.');
    }

    return db;
  }

  public get dbSslMode(): boolean {
    const sm = this.DB_SSLMODE;
    if (sm === undefined) {
      throw new InvalidConfigurationError('DB_SSLMODE is not defined.');
    }

    return sm === 'true';
  }

  public get dbDatabaseUrl(): string {
    const url = this.DB_DATABASE_URL;
    if (!url) {
      throw new InvalidConfigurationError('DB_DATABASE_URL is not defined.');
    }

    return url;
  }

  public get dbAtlas(): string {
    const atlas = this.DB_ATLAS;
    if (!atlas) {
      throw new InvalidConfigurationError('DB_ATLAS is not defined.');
    }

    return atlas;
  }
}
