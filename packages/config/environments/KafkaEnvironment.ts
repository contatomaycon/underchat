import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

export class KafkaEnvironment {
  public get kafkaBroker(): string {
    const broker = process.env.KAFKA_BROKER;
    if (!broker) {
      throw new InvalidConfigurationError('KAFKA_BROKER is not defined.');
    }

    return broker;
  }
}
