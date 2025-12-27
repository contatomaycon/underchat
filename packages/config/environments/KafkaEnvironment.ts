import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class KafkaEnvironment {
  public get kafkaBroker(): string {
    const broker = process.env.KAFKA_BROKER;
    if (!broker) {
      throw new InvalidConfigurationError('KAFKA_BROKER is not defined.');
    }

    return broker;
  }

  public get kafkaUsername(): string {
    const username = process.env.KAFKA_USERNAME;
    if (!username) {
      throw new InvalidConfigurationError('KAFKA_USERNAME is not defined.');
    }

    return username;
  }

  public get kafkaPassword(): string {
    const password = process.env.KAFKA_PASSWORD;
    if (!password) {
      throw new InvalidConfigurationError('KAFKA_PASSWORD is not defined.');
    }

    return password;
  }

  public get securityProtocol(): string {
    const securityProtocol = process.env.SECURITY_PROTOCOL;
    if (!securityProtocol) {
      throw new InvalidConfigurationError('SECURITY_PROTOCOL is not defined.');
    }

    return securityProtocol.toLowerCase();
  }

  public get saslMechanism(): string {
    const saslMechanism = process.env.SASL_MECHANISM;
    if (!saslMechanism) {
      throw new InvalidConfigurationError('SASL_MECHANISM is not defined.');
    }

    return saslMechanism.toUpperCase();
  }
}
