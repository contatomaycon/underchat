import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class TelemetryEnvironment {
  public get sentryDsn(): string | undefined {
    return process.env.SENTRY_DSN;
  }

  public get sentryEnvironment(): string {
    return (
      process.env.SENTRY_ENVIRONMENT ||
      process.env.APP_ENVIRONMENT ||
      'development'
    );
  }

  public get sentryTracesSampleRate(): number {
    const rate = process.env.SENTRY_TRACES_SAMPLE_RATE;
    if (!rate) {
      return 1.0;
    }

    const parsed = Number.parseFloat(rate);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      return 1.0;
    }

    return parsed;
  }

  public get sentryProfilesSampleRate(): number {
    const rate = process.env.SENTRY_PROFILES_SAMPLE_RATE;
    if (!rate) {
      return 1.0;
    }

    const parsed = Number.parseFloat(rate);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
      return 1.0;
    }

    return parsed;
  }

  public get logLevel(): string {
    return process.env.LOG_LEVEL || 'info';
  }

  public get enableSentry(): boolean {
    return process.env.ENABLE_SENTRY === 'true' && !!this.sentryDsn;
  }

  public get sentryServiceName(): string {
    const serviceName = process.env.SENTRY_SERVICE_NAME;
    if (!serviceName) {
      throw new InvalidConfigurationError(
        'SENTRY_SERVICE_NAME is not defined.'
      );
    }

    return serviceName;
  }
}
