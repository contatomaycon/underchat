import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

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
