import * as dotenv from 'dotenv';
import InvalidConfigurationError from '@core/common/exceptions/InvalidConfigurationError';

dotenv.config({
  path: '../../.env',
});

export class KafkaEnvironment {
  private readonly KAFKA_BROKER: string | undefined;

  constructor() {
    this.KAFKA_BROKER = process.env.KAFKA_BROKER;
  }

  public get kafkaBroker(): string {
    if (!this.KAFKA_BROKER) {
      throw new InvalidConfigurationError('KAFKA_BROKER is not defined.');
    }

    return this.KAFKA_BROKER;
  }
}
