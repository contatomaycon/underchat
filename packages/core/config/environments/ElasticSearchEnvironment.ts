import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

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
    const host = this.ELASTIC_SEARCH_HOST;
    if (!host) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_HOST is not defined.'
      );
    }

    return host;
  }

  public get elasticSearchUser(): string {
    const user = this.ELASTIC_SEARCH_USER;
    if (!user) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_USER is not defined.'
      );
    }

    return user;
  }

  public get elasticSearchPassword(): string {
    const password = this.ELASTIC_SEARCH_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_PASSWORD is not defined.'
      );
    }

    return password;
  }
}
