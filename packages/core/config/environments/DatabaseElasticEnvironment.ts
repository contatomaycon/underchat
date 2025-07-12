import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

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
    if (!this.DB_ELASTIC_HOST) {
      throw new InvalidConfigurationError('DB_ELASTIC_HOST is not defined.');
    }

    return this.DB_ELASTIC_HOST;
  }

  public get elasticSearchUser(): string {
    if (!this.DB_ELASTIC_USER) {
      throw new InvalidConfigurationError('DB_ELASTIC_USER is not defined.');
    }

    return this.DB_ELASTIC_USER;
  }

  public get elasticSearchPassword(): string {
    if (!this.DB_ELASTIC_PASSWORD) {
      throw new InvalidConfigurationError(
        'DB_ELASTIC_PASSWORD is not defined.'
      );
    }

    return this.DB_ELASTIC_PASSWORD;
  }
}
