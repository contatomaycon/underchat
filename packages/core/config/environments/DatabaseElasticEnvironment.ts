import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class DatabaseElasticEnvironment {
  public get elasticSearchHost(): string {
    const host = process.env.DB_ELASTIC_HOST;
    if (!host) {
      throw new InvalidConfigurationError('DB_ELASTIC_HOST is not defined.');
    }

    return host;
  }

  public get elasticSearchUser(): string {
    const user = process.env.DB_ELASTIC_USER;
    if (!user) {
      throw new InvalidConfigurationError('DB_ELASTIC_USER is not defined.');
    }

    return user;
  }

  public get elasticSearchPassword(): string {
    const password = process.env.DB_ELASTIC_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError(
        'DB_ELASTIC_PASSWORD is not defined.'
      );
    }

    return password;
  }
}
