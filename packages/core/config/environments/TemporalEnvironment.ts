import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class TemporalEnvironment {
  public getTemporalHost(): string {
    if (!process.env.TEMPORAL_HOST) {
      throw new InvalidConfigurationError('TEMPORAL_HOST');
    }

    return process.env.TEMPORAL_HOST;
  }

  public getTemporalPort(): string {
    if (!process.env.TEMPORAL_PORT) {
      throw new InvalidConfigurationError('TEMPORAL_PORT');
    }

    return process.env.TEMPORAL_PORT;
  }
}
