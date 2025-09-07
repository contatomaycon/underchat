import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';
import * as dotenv from 'dotenv';

dotenv.config({
  path: '../../.env',
});

export class KafkaEnvironment {
  private readonly KAFKA_BROKER: string | undefined;

  constructor() {
    this.KAFKA_BROKER = process.env.KAFKA_BROKER;
  }

  public get kafkaBroker(): string {
    const broker = this.KAFKA_BROKER;
    if (!broker) {
      throw new InvalidConfigurationError('KAFKA_BROKER is not defined.');
    }

    return broker;
  }
}
