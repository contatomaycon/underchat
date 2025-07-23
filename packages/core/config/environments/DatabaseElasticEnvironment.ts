import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class DatabaseElasticEnvironment {
  private readonly DB_ELASTIC_HOST: string | undefined;
  private readonly DB_ELASTIC_USER: string | undefined;
  private readonly DB_ELASTIC_PASSWORD: string | undefined;

  constructor() {
    this.DB_ELASTIC_HOST = process.env.DB_ELASTIC_HOST;
    this.DB_ELASTIC_USER = process.env.DB_ELASTIC_USER;
    this.DB_ELASTIC_PASSWORD = process.env.DB_ELASTIC_PASSWORD;
  }

  public get elasticSearchHost(): string {
    const host = this.DB_ELASTIC_HOST;
    if (!host) {
      throw new InvalidConfigurationError('DB_ELASTIC_HOST is not defined.');
    }

    return host;
  }

  public get elasticSearchUser(): string {
    const user = this.DB_ELASTIC_USER;
    if (!user) {
      throw new InvalidConfigurationError('DB_ELASTIC_USER is not defined.');
    }

    return user;
  }

  public get elasticSearchPassword(): string {
    const password = this.DB_ELASTIC_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError(
        'DB_ELASTIC_PASSWORD is not defined.'
      );
    }

    return password;
  }
}
