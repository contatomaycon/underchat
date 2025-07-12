import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

dotenv.config({
  path: '../../.env',
});

export class DatabaseEnvironment {
  private readonly DB_HOST: string | undefined;
  private readonly DB_PORT: number | undefined;
  private readonly DB_USER: string | undefined;
  private readonly DB_PASSWORD: string | undefined;
  private readonly DB_DATABASE: string | undefined;
  private readonly DB_SSLMODE: string | undefined;
  private readonly DB_DATABASE_URL: string | undefined;
  private readonly DB_ATLAS: string | undefined;

  constructor() {
    this.DB_HOST = process.env.DB_HOST;
    this.DB_PORT = Number(process.env.DB_PORT);
    this.DB_USER = process.env.DB_USER;
    this.DB_PASSWORD = process.env.DB_PASSWORD;
    this.DB_DATABASE = process.env.DB_DATABASE;
    this.DB_SSLMODE = process.env.DB_SSLMODE;
    this.DB_DATABASE_URL = process.env.DB_DATABASE_URL;
    this.DB_ATLAS = process.env.DB_ATLAS;
  }

  public get dbHost(): string {
    if (!this.DB_HOST) {
      throw new InvalidConfigurationError('DB_HOST is not defined.');
    }

    return this.DB_HOST;
  }

  public get dbPort(): number {
    if (!this.DB_PORT) {
      throw new InvalidConfigurationError('DB_PORT is not defined.');
    }

    return this.DB_PORT;
  }

  public get dbUser(): string {
    if (!this.DB_USER) {
      throw new InvalidConfigurationError('DB_USER is not defined.');
    }

    return this.DB_USER;
  }

  public get dbPassword(): string {
    if (!this.DB_PASSWORD) {
      throw new InvalidConfigurationError('DB_PASSWORD is not defined.');
    }

    return this.DB_PASSWORD;
  }

  public get dbDatabase(): string {
    if (!this.DB_DATABASE) {
      throw new InvalidConfigurationError('DB_DATABASE is not defined.');
    }

    return this.DB_DATABASE;
  }

  public get dbSslMode(): boolean {
    if (!this.DB_SSLMODE) {
      throw new InvalidConfigurationError('DB_SSLMODE is not defined.');
    }

    return this.DB_SSLMODE === 'true';
  }

  public get dbDatabaseUrl(): string {
    if (!this.DB_DATABASE_URL) {
      throw new InvalidConfigurationError('DB_DATABASE_URL is not defined.');
    }

    return this.DB_DATABASE_URL;
  }

  public get dbAtlas(): string {
    if (!this.DB_ATLAS) {
      throw new InvalidConfigurationError('DB_ATLAS is not defined.');
    }

    return this.DB_ATLAS;
  }
}
