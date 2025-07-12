import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

dotenv.config({
  path: '../../.env',
});

export class ElasticSearchEnvironment {
  private readonly ELASTIC_SEARCH_HOST: string | undefined;
  private readonly ELASTIC_SEARCH_USER: string | undefined;
  private readonly ELASTIC_SEARCH_PASSWORD: string | undefined;

  constructor() {
    this.ELASTIC_SEARCH_HOST = process.env.ELASTIC_SEARCH_HOST;
    this.ELASTIC_SEARCH_USER = process.env.ELASTIC_SEARCH_USER;
    this.ELASTIC_SEARCH_PASSWORD = process.env.ELASTIC_SEARCH_PASSWORD;
  }

  public get elasticSearchHost(): string {
    if (!this.ELASTIC_SEARCH_HOST) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_HOST is not defined.'
      );
    }

    return this.ELASTIC_SEARCH_HOST;
  }

  public get elasticSearchUser(): string {
    if (!this.ELASTIC_SEARCH_USER) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_USER is not defined.'
      );
    }

    return this.ELASTIC_SEARCH_USER;
  }

  public get elasticSearchPassword(): string {
    if (!this.ELASTIC_SEARCH_PASSWORD) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_PASSWORD is not defined.'
      );
    }

    return this.ELASTIC_SEARCH_PASSWORD;
  }
}
