import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class ElasticSearchEnvironment {
  public get elasticSearchHost(): string {
    const host = process.env.ELASTIC_SEARCH_HOST;
    if (!host) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_HOST is not defined.'
      );
    }

    return host;
  }

  public get elasticSearchUser(): string {
    const user = process.env.ELASTIC_SEARCH_USER;
    if (!user) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_USER is not defined.'
      );
    }

    return user;
  }

  public get elasticSearchPassword(): string {
    const password = process.env.ELASTIC_SEARCH_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError(
        'ELASTIC_SEARCH_PASSWORD is not defined.'
      );
    }

    return password;
  }
}
